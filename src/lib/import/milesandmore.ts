import { differenceInSeconds, parseISO } from 'date-fns';
import { z } from 'zod';
import { page } from '$app/state';
import type { CreateFlight, SeatClasses } from '$lib/db/types';
import type { PlatformOptions } from '$lib/components/modals/settings/pages/import-page';
import { api } from '$lib/trpc';
import { airlineFromIATA } from '$lib/utils/data/airlines';
import { extractIACOFromMilesAndMoreCode } from '$lib/utils/data/aircraft'

// Define a Zod schema for a single Miles and More flight segment.
const MilesAndMoreFlightSchema = z.object({
  DepartureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Invalid date format in DepartureDate',
  }),
  ArrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Invalid date format in ArrivalDate',
  }).optional(),
  OriginCityCode: z.string(),
  OriginCityName: z.string(),
  DestinationCityCode: z.string(),
  DestinationCityName: z.string(),
  OriginAirportCode: z.string(),
  OriginAirportName: z.string(),
  DestinationAirportCode: z.string(),
  DestinationAirportName: z.string(),
  StatusPoints: z.number(),
  GupPoints: z.number(),
  HonPoints: z.number(),
  AirlineDesignatorCode: z.string(),
  FlightNumber: z.number(),
  CompartmentClass: z.string(),
  AircraftCode: z.string().optional(),
  Distance: z.number(),
  TimeOnPlane: z.number().optional(),
  StatusMiles: z.number(),
  AwardMiles: z.number(),
  DepartureTime: z
    .string()
    .datetime({ offset: true, message: 'Invalid datetime in DepartureTime' }).optional(),
  ArrivalTime: z
    .string()
    .datetime({ offset: true, message: 'Invalid datetime in ArrivalTime' }).optional(),
  Honmiles: z.number(),
  PnrrecordLocator: z.string().optional(),
});

const MilesAndMoreFileSchema = z.object({
  SegmentListResponses: z
    .array(MilesAndMoreFlightSchema)
    .min(1, 'At least one flight is required'),
});

const MILES_SEAT_CLASS_MAP: Record<string, (typeof SeatClasses)[number]> = {
  F: 'first',
  C: 'business',
  E: 'economy+',
  M: 'economy',
};

export const processMandMFile = async (
  input: string,
  options: PlatformOptions,
) => {
  const user = page.data.user;
  if (!user) {
    throw new Error('User not found');
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (_) {
    throw new Error('Invalid JSON found in Miles and More file');
  }

  const result = MilesAndMoreFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.message);
  }

  const flights: CreateFlight[] = [];
  const unknownAirports: string[] = [];
  const segments = result.data.SegmentListResponses;

  for (const segment of segments) {
    const rawFrom = segment.OriginAirportCode.trim();
    const rawTo = segment.DestinationAirportCode.trim();
    const from = await api.airport.getFromIATA.query(rawFrom);
    const to = await api.airport.getFromIATA.query(rawTo);

    if (!from || !to) {
      if (!from && rawFrom && !unknownAirports.includes(rawFrom)) {
        unknownAirports.push(rawFrom);
      }
      if (!to && rawTo && !unknownAirports.includes(rawTo)) {
        unknownAirports.push(rawTo);
      }
      continue;
    }

    // Parse the ISO datetime strings.
    const departure = segment.DepartureTime ? parseISO(segment.DepartureTime) : parseISO(segment.DepartureDate);
    const arrival = segment.ArrivalTime ? parseISO(segment.ArrivalTime) : departure;
    const duration = (segment.TimeOnPlane !== undefined && segment.TimeOnPlane !== null)
      ? segment.TimeOnPlane
      : differenceInSeconds(arrival, departure);

    // Use the AirlineDesignatorCode to determine the airline.
    const airlineIata = segment.AirlineDesignatorCode.trim();
    let airline: string | null = null;
    if (airlineIata) {
     const airline = airlineIata ? (airlineFromIATA(airlineIata)?.icao ?? null) : null;
    }

    // Map the compartment class to a seat class.
    const rawSeatClass = segment.CompartmentClass.trim();
    const seatClass = MILES_SEAT_CLASS_MAP[rawSeatClass] ?? null;

    const flightNumber = String(segment.AirlineDesignatorCode).trim() + String(segment.FlightNumber).trim();
  
    flights.push({
      date: segment.DepartureDate,
      from,
      to,
      departure: departure.toISOString(),
      arrival: arrival.toISOString(),
      duration,
      flightNumber: flightNumber,
      flightReason: null,
      airline,
      aircraft: extractIACOFromMilesAndMoreCode(segment.AircraftCode),
      aircraftReg: null,
      note: [
        segment.PnrrecordLocator ? `PNR: ${segment.PnrrecordLocator.trim()}` : '',
        segment.StatusMiles > 0 ? `Status Miles: ${segment.StatusMiles}` : '',
        segment.AwardMiles > 0 ? `Award Miles: ${segment.AwardMiles}` : '',
        segment.Honmiles > 0 ? `HON Circle Miles: ${segment.Honmiles}` : '',
        segment.StatusPoints > 0 ? `Points: ${segment.StatusMiles}` : '',
        segment.GupPoints > 0 ? `Qualifying Points: ${segment.AwardMiles}` : '',
        segment.HonPoints > 0 ? `HON Circle Points: ${segment.Honmiles}` : ''
      ].filter(Boolean).join('\n'),
      seats: [
        {
          userId: user.id,
          seat: null,
          seatNumber: null,
          seatClass,
          guestName: null,
        },
      ],
    });
  }

  return {
    flights,
    unknownAirports,
  };
};