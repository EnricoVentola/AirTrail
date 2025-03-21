import { AIRCRAFT } from '$lib/data/aircraft';
import { toTitleCase } from '../string';

const labelCache = new Map<string, string | null>();

export type Aircraft = (typeof AIRCRAFT)[number];

export const WTC_TO_LABEL = {
  L: 'Light',
  M: 'Medium',
  H: 'Heavy',
  J: 'Super',
};

export const aircraftFromICAO = (icao: string): Aircraft | null => {
  return AIRCRAFT.find((aircraft) => aircraft.icao === icao) ?? null;
};

export const getAircraftLabel = (icao: string): string | null => {
  if (labelCache.has(icao)) return labelCache.get(icao)!;

  const aircraft = aircraftFromICAO(icao);
  if (!aircraft || !aircraft.name) {
    labelCache.set(icao, null);
    return null;
  }
  const parts = aircraft.name.split(' ');
  const manufacturer = parts[0]!;
  const model = parts[1]!;
  const label = `${toTitleCase(manufacturer)} ${toTitleCase(model)}`;
  labelCache.set(icao, label);
  return label;
};

export function extractIACOFromMilesAndMoreCode(aircraftCode?: string): string | null {
  if (!aircraftCode) return null;
  const code = aircraftCode.trim();

  // Rule for "223": map to Airbus A220-300.
  if (code === "223") {
    const entry = AIRCRAFT.find(a => a.name.includes("A220-300"));
    if (entry) return entry.icao;
  }

  // Rule for Airbus A320 family:
  // If code starts with "32" (optionally with one letter at the end)
  if (/^32[A-Z]?$/i.test(code)) {
    if (code.toUpperCase().endsWith("N")) {
      // Assume it's an A320neo.
      const entry = AIRCRAFT.find(a => a.name.toLowerCase().includes("a320neo"));
      if (entry) return entry.icao;
    } else {
      // Assume it's an A320 (non-neo).
      const entry = AIRCRAFT.find(a => a.name.toLowerCase().includes("a320") && !a.name.toLowerCase().includes("neo"));
      if (entry) return entry.icao;
    }
  }

  // Rule for Embraer:
  // If the code starts with "E" and is exactly 3 characters (e.g. "E95"), assume it should be "E195".
  if (/^E\d{2}$/i.test(code)) {
    const entry = AIRCRAFT.find(a => a.name.toLowerCase().includes("e195"));
    if (entry) return entry.icao;
  }

  // Rule for Canadair Regional Jets:
  // If the code starts with "CR" and is exactly 3 characters (e.g. "CR9"),
  // assume it should be a CRJ-900.
  if (/^CR\d$/i.test(code)) {
    const entry = AIRCRAFT.find(a => a.name.toLowerCase().includes("crj-900"));
    if (entry) return entry.icao;
  }
  // If the code starts with "CR" and is 4 characters but the third character is a digit,
  // also assume it's missing a "J".
  if (/^CR\d{2}$/i.test(code) && /\d/.test(code.charAt(2))) {
    const entry = AIRCRAFT.find(a => a.name.toLowerCase().includes("crj-900"));
    if (entry) return entry.icao;
  }

  // Fallback for Airbus: if the code is purely numeric and has 3 digits,
  // assume it's an Airbus and prepend "A".
  if (/^\d{3}$/.test(code)) {
    const candidate = "A" + code;
    const entry = AIRCRAFT.find(a => a.icao === candidate);
    if (entry) return entry.icao;
  }

  // Otherwise, return null.
  return null;
}
