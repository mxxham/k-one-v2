/**
 * Location Code Parser (Frontend)
 * 
 * Format: CD01A02
 * - CD = Rack identifier (2 chars)
 * - 01 = Rack number (2 digits)
 * - A  = Level (A=bottom, B, C, D, E=top) (1 char)
 * - 02 = Position number (2 digits)
 * 
 * Most important: Rack (CD) and Level (A)
 */

export interface ParsedLocation {
  original: string;
  rack: string;           // e.g., "CD"
  rackNumber: string;     // e.g., "01"
  level: string;          // e.g., "A" (A=bottom, E=top)
  position: string;       // e.g., "02"
  fullRack: string;       // e.g., "CD01"
  displayShort: string;   // e.g., "CD-A" (Rack-Level)
  displayFull: string;    // e.g., "CD01-A-02"
  levelHeight: number;    // 1-5 (A=1, B=2, C=3, D=4, E=5)
  isValid: boolean;
}

const LEVEL_MAP: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
};

const LEVEL_NAMES: Record<string, string> = {
  A: 'Bottom',
  B: 'Lower',
  C: 'Middle',
  D: 'Upper',
  E: 'Top',
};

const LEVEL_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  B: 'bg-green-100 text-green-700 border-green-300',
  C: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  D: 'bg-orange-100 text-orange-700 border-orange-300',
  E: 'bg-red-100 text-red-700 border-red-300',
};

/**
 * Parse location code into structured components
 */
export function parseLocation(locationCode: string): ParsedLocation {
  const original = locationCode.trim().toUpperCase();
  
  // Default invalid response
  const invalid: ParsedLocation = {
    original,
    rack: '',
    rackNumber: '',
    level: '',
    position: '',
    fullRack: '',
    displayShort: original,
    displayFull: original,
    levelHeight: 0,
    isValid: false,
  };

  // Expected format: 2 chars (rack) + 2 digits (rack#) + 1 char (level) + 2 digits (pos)
  // Example: CD01A02
  const regex = /^([A-Z]{2})(\d{2})([A-E])(\d{2})$/;
  const match = original.match(regex);

  if (!match) {
    return invalid;
  }

  const [, rack, rackNumber, level, position] = match;
  const fullRack = `${rack}${rackNumber}`;
  const displayShort = `${rack}-${level}`;
  const displayFull = `${rack}${rackNumber}-${level}-${position}`;
  const levelHeight = LEVEL_MAP[level] || 0;

  return {
    original,
    rack,
    rackNumber,
    level,
    position,
    fullRack,
    displayShort,
    displayFull,
    levelHeight,
    isValid: true,
  };
}

/**
 * Get level name (Bottom, Lower, Middle, Upper, Top)
 */
export function getLevelName(level: string): string {
  return LEVEL_NAMES[level.toUpperCase()] || level;
}

/**
 * Get level color classes for Tailwind
 */
export function getLevelColor(level: string): string {
  return LEVEL_COLORS[level.toUpperCase()] || 'bg-gray-100 text-gray-700 border-gray-300';
}

/**
 * Format location for display with emphasis on Rack and Level
 */
export function formatLocationDisplay(locationCode: string, format: 'short' | 'full' | 'detailed' = 'short'): string {
  const parsed = parseLocation(locationCode);
  
  if (!parsed.isValid) {
    return locationCode;
  }

  switch (format) {
    case 'short':
      return parsed.displayShort; // CD-A
    case 'full':
      return parsed.displayFull; // CD01-A-02
    case 'detailed':
      return `${parsed.fullRack} • Level ${parsed.level} (${getLevelName(parsed.level)}) • Pos ${parsed.position}`; // CD01 • Level A (Bottom) • Pos 02
    default:
      return parsed.displayShort;
  }
}

/**
 * Sort locations by rack, then level (bottom to top), then position
 */
export function sortLocations(locations: string[]): string[] {
  return locations.sort((a, b) => {
    const parsedA = parseLocation(a);
    const parsedB = parseLocation(b);

    // Invalid locations go to end
    if (!parsedA.isValid && !parsedB.isValid) return 0;
    if (!parsedA.isValid) return 1;
    if (!parsedB.isValid) return -1;

    // Sort by rack
    if (parsedA.rack !== parsedB.rack) {
      return parsedA.rack.localeCompare(parsedB.rack);
    }

    // Sort by rack number
    if (parsedA.rackNumber !== parsedB.rackNumber) {
      return parsedA.rackNumber.localeCompare(parsedB.rackNumber);
    }

    // Sort by level (bottom to top)
    if (parsedA.levelHeight !== parsedB.levelHeight) {
      return parsedA.levelHeight - parsedB.levelHeight;
    }

    // Sort by position
    return parsedA.position.localeCompare(parsedB.position);
  });
}

/**
 * Group locations by rack
 */
export function groupLocationsByRack(locations: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  
  for (const loc of locations) {
    const parsed = parseLocation(loc);
    if (parsed.isValid) {
      const key = parsed.fullRack;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(loc);
    }
  }

  return groups;
}

/**
 * Get location accessibility score (lower level = easier access)
 * A (bottom) = 5 (easiest), E (top) = 1 (hardest)
 */
export function getAccessibilityScore(locationCode: string): number {
  const parsed = parseLocation(locationCode);
  if (!parsed.isValid) return 0;
  
  // Invert level height for accessibility (bottom = highest score)
  return 6 - parsed.levelHeight; // A=5, B=4, C=3, D=2, E=1
}

/**
 * Suggest best location from a list (prioritize lower levels for easier access)
 */
export function suggestBestLocation(locations: string[]): string | null {
  if (locations.length === 0) return null;
  
  const sorted = [...locations].sort((a, b) => {
    const scoreA = getAccessibilityScore(a);
    const scoreB = getAccessibilityScore(b);
    return scoreB - scoreA; // Higher score first
  });

  return sorted[0];
}
