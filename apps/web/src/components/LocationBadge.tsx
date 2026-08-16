import { parseLocation, formatLocationDisplay, getLevelName, getLevelColor } from '@/lib/location-parser';
import { MapPin } from 'lucide-react';

interface LocationBadgeProps {
  locationCode: string;
  format?: 'short' | 'full' | 'detailed';
  showIcon?: boolean;
  showLevel?: boolean;
  className?: string;
}

/**
 * LocationBadge - Displays location codes with proper parsing and formatting
 * 
 * Format: CD01A02 → Rack CD, Level A (Bottom)
 */
export default function LocationBadge({ 
  locationCode, 
  format = 'short',
  showIcon = false,
  showLevel = false,
  className = '' 
}: LocationBadgeProps) {
  if (!locationCode || locationCode.trim() === '') {
    return <span className="text-gray-400">—</span>;
  }

  const parsed = parseLocation(locationCode);

  // If invalid format, just show the original code
  if (!parsed.isValid) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-mono ${className}`}>
        {showIcon && <MapPin className="w-3 h-3" />}
        {locationCode}
      </span>
    );
  }

  const levelColor = getLevelColor(parsed.level);
  const displayText = formatLocationDisplay(locationCode, format);

  if (format === 'detailed') {
    return (
      <div className={`inline-flex flex-col gap-1 ${className}`}>
        <div className="flex items-center gap-2">
          {showIcon && <MapPin className="w-4 h-4 text-brand-600" />}
          <span className="font-mono font-semibold text-brand-700 text-sm">
            {parsed.fullRack}
          </span>
          <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${levelColor}`}>
            Level {parsed.level}
          </span>
        </div>
        <div className="text-xs text-gray-500">
          {getLevelName(parsed.level)} • Position {parsed.position}
        </div>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {showIcon && <MapPin className="w-3.5 h-3.5 text-brand-600" />}
      
      {/* Rack - emphasized */}
      <span className="font-mono font-bold text-brand-700">
        {format === 'short' ? parsed.rack : parsed.fullRack}
      </span>
      
      {/* Separator */}
      <span className="text-gray-400">-</span>
      
      {/* Level - color coded */}
      <span className={`px-1.5 py-0.5 rounded border text-xs font-bold ${levelColor}`}>
        {parsed.level}
      </span>
      
      {/* Show level name if requested */}
      {showLevel && (
        <span className="text-xs text-gray-500">
          ({getLevelName(parsed.level)})
        </span>
      )}
      
      {/* Position for full format */}
      {format === 'full' && (
        <>
          <span className="text-gray-400">-</span>
          <span className="font-mono text-xs text-gray-600">
            {parsed.position}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * LocationList - Display multiple locations grouped or sorted
 */
interface LocationListProps {
  locations: string[];
  format?: 'short' | 'full' | 'detailed';
  grouped?: boolean;
  maxDisplay?: number;
  className?: string;
}

export function LocationList({ 
  locations, 
  format = 'short', 
  grouped = false,
  maxDisplay,
  className = '' 
}: LocationListProps) {
  if (locations.length === 0) {
    return <span className="text-gray-400 text-sm">No locations</span>;
  }

  const displayLocations = maxDisplay ? locations.slice(0, maxDisplay) : locations;
  const remaining = maxDisplay && locations.length > maxDisplay ? locations.length - maxDisplay : 0;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {displayLocations.map((loc, idx) => (
        <LocationBadge 
          key={`${loc}-${idx}`}
          locationCode={loc} 
          format={format}
        />
      ))}
      {remaining > 0 && (
        <span className="text-xs text-gray-500 px-2 py-0.5">
          +{remaining} more
        </span>
      )}
    </div>
  );
}
