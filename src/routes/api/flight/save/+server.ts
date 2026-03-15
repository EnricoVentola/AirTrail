import { json } from '@sveltejs/kit';
import { z } from 'zod';

import type { RequestHandler } from './$types';

import { getAircraftByIcao } from '$lib/server/utils/aircraft';
import { getAirlineByIcao } from '$lib/server/utils/airline';
import { getAirportByIcao } from '$lib/server/utils/airport';
import { getFlightRoute } from '$lib/server/utils/flight-lookup/flight-lookup';
import { apiError, unauthorized, validateApiKey } from '$lib/server/utils/api';
import { format } from 'date-fns';
import { validateAndSaveFlight } from '$lib/server/utils/flight';
import { aircraftSchema } from '$lib/zod/aircraft';
import { airlineSchema } from '$lib/zod/airline';
import { flightSchema } from '$lib/zod/flight';


const defaultFlight = {
  // from, to and departure are required
  arrival: null,
  arrivalScheduled: null,
  departureTime: null,
  arrivalTime: null,
  departureScheduled: null,
  departureScheduledTime: null,
  arrivalScheduledTime: null,
  takeoffScheduled: null,
  takeoffScheduledTime: null,
  takeoffActual: null,
  takeoffActualTime: null,
  landingScheduled: null,
  landingScheduledTime: null,
  landingActual: null,
  landingActualTime: null,
  airline: null,
  flightNumber: null,
  aircraft: null,
  aircraftReg: null,
  flightReason: null,
  note: null,
  customFields: {},
};

const defaultSeat = {
  guestName: null,
  seat: null,
  seatNumber: null,
  seatClass: null,
};

const saveApiFlightSchema = flightSchema
  .merge(
    z.object({
      from: z.string(),
      to: z.string(),
    }),
  )
  .merge(
    z.object({
      aircraft: aircraftSchema.shape.icao,
    }),
  )
  .merge(
    z.object({
      airline: airlineSchema.shape.icao,
    }),
  );

const dateTimeSchema = z.string().datetime({ offset: true });

const getAirportByCode = async (input: string) => {
  return (await getAirportByIcao(input)) ?? (await getAirportByIata(input));
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const filled = {
    ...defaultFlight,
    ...body,
    seats: Array.isArray(body.seats)
      ? body.seats.map((s: unknown) => ({
          ...defaultSeat,
          ...(s && typeof s === 'object' ? s : {}),
        }))
      : [],
  };
  const flight = {
    ...filled,
    departure: dateTimeSchema.safeParse(filled.departure).success
      ? filled.departure
      : filled.departure
        ? filled.departure + 'T10:00:00.000+00:00'
        : null,
    arrival: dateTimeSchema.safeParse(filled.arrival).success
      ? filled.arrival
      : filled.arrival
        ? filled.arrival + 'T10:00:00.000+00:00'
        : null,
  };

  let parsed = saveApiFlightSchema.safeParse(flight);
  let lookupAttempted = false;
  let lookupFound = false;
  let lookupNoElapsedMatch = false;

  // If initial validation fails but flight number is provided, try lookup
  console.log('Initial parse success:', parsed.success);
  console.log('body.flightNumber:', body.flightNumber);
  console.log('body.from:', body.from, 'body.to:', body.to);
  
  if (!parsed.success && body.flightNumber && (!body.from || !body.to)) {
    console.log('Attempting lookup...');
    lookupAttempted = true;
    try {
const opts = body.departure
        ? { date: new Date(body.departure.split('T')[0]) }
        : { date: new Date() };
      const routes = await getFlightRoute(body.flightNumber, opts);
      if (Array.isArray(routes) && routes.length > 0) {
        const userProvidedDeparture = !!body.departure;
        let chosen: typeof routes[0] | null = null;

        if (userProvidedDeparture) {
          chosen = routes[0] ?? null;
        } else {
          const now = Date.now();
          chosen = routes.find((r) => r.arrival && r.arrival.getTime() <= now) ?? null;
          if (!chosen && routes.length > 0) {
            lookupNoElapsedMatch = true;
          }
        }

        if (chosen) {
          flight.from = flight.from ?? chosen.from?.icao;
          flight.to = flight.to ?? chosen.to?.icao;
          flight.airline = flight.airline ?? chosen.airline?.icao ?? flight.airline;
          flight.aircraft = flight.aircraft ?? chosen.aircraft?.icao ?? flight.aircraft;
          flight.aircraftReg = flight.aircraftReg ?? chosen.aircraftReg ?? null;

          if (chosen.departure) {
            flight.departure = chosen.departure.toISOString();
            flight.departureTime = format(chosen.departure, 'HH:mm');
          }
          if (chosen.arrival) {
            flight.arrival = chosen.arrival.toISOString();
            flight.arrivalTime = format(chosen.arrival, 'HH:mm');
          }
          if (chosen.departureScheduled) {
            flight.departureScheduled = chosen.departureScheduled.toISOString();
            flight.departureScheduledTime = format(chosen.departureScheduled, 'HH:mm');
          }
          if (chosen.arrivalScheduled) {
            flight.arrivalScheduled = chosen.arrivalScheduled.toISOString();
            flight.arrivalScheduledTime = format(chosen.arrivalScheduled, 'HH:mm');
          }

          flight.departureTerminal = flight.departureTerminal ?? chosen.departureTerminal ?? null;
          flight.departureGate = flight.departureGate ?? chosen.departureGate ?? null;
          flight.arrivalTerminal = flight.arrivalTerminal ?? chosen.arrivalTerminal ?? null;
          flight.arrivalGate = flight.arrivalGate ?? chosen.arrivalGate ?? null;

          parsed = saveApiFlightSchema.safeParse(flight);
          if (parsed.success) {
            lookupFound = true;
            console.log('Lookup succeeded, flight populated');
          } else {
            console.log('Lookup populated flight but re-parse failed:', parsed.error.errors);
          }
        } else {
          console.log('Lookup did not find suitable route. userProvidedDeparture:', userProvidedDeparture, 'routes:', routes.length);
        }
      } else {
        console.log('Lookup returned no routes');
      }
    } catch (e) {
      // Lookup failed; fall through to validation error handling
      console.log('Lookup threw error:', e);
    }
  } else {
    console.log('Skipping lookup:', { parsed_success: parsed.success, hasFlightNumber: !!body.flightNumber, hasFrom: !!body.from, hasTo: !!body.to });
  }

  if (!parsed.success) {
    if (lookupAttempted && !lookupFound && body.flightNumber) {
      if (lookupNoElapsedMatch) {
        return apiError('Flight not yet arrived. Specify a departure date to look up past flights.');
      }
      return apiError('No matching flight route found for provided flight number');
    }
    return json(
      { success: false, errors: parsed.error.errors },
      { status: 400 },
    );
  }

  const user = await validateApiKey(request);
  if (!user) {
    return unauthorized();
  }

  const from = await getAirportByCode(parsed.data.from);
  if (!from) {
    return apiError('Invalid departure airport');
  }

  const to = await getAirportByCode(parsed.data.to);
  if (!to) {
    return apiError('Invalid arrival airport');
  }

  let aircraft;
  if (parsed.data.aircraft) {
    aircraft = await getAircraftByIcao(parsed.data.aircraft);
    if (!aircraft) {
      return apiError('Invalid aircraft');
    }
  }

  let airline;
  if (parsed.data.airline) {
    airline = await getAirlineByIcao(parsed.data.airline);
    if (!airline) {
      return apiError('Invalid airline');
    }
  }

  const data = {
    ...parsed.data,
    from,
    to,
    aircraft,
    airline,
  };

  // Validate and normalize seat user IDs: ensure any provided userId exists in user table
  for (const seat of data.seats) {
    if (!seat.userId || seat.userId === '<USER_ID>') {
      seat.userId = user.id;
      continue;
    }

    const found = await db
      .selectFrom('user')
      .select('id')
      .where('id', '=', seat.userId)
      .executeTakeFirst();
    console.log(`Seat userId validation: ${seat.userId} found=${!!found}`);
    if (!found) {
      return apiError(`Invalid seat userId: ${seat.userId}`);
    }
  }

  const result = await validateAndSaveFlight(user, data);
  if (!result.success) {
    // @ts-expect-error - this should be valid
    return apiError(result.message, result.status || 500);
  }

  return json({ success: true, ...(result.id && { id: result.id }) });
};
