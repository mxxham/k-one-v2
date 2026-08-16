import { useState } from 'react';
import { parseLocation, formatLocationDisplay, sortLocations, groupLocationsByRack, getAccessibilityScore, suggestBestLocation, getLevelName } from '@/lib/location-parser';
import LocationBadge, { LocationList } from '@/components/LocationBadge';
import { Card } from '@/components/Card';

/**
 * Location Mapping Examples Page
 * Demonstrates the improved location parsing and display
 */
export default function LocationExamplesPage() {
  const [testCode, setTestCode] = useState('CD01A02');
  const parsed = parseLocation(testCode);

  const exampleLocations = [
    'CD01A02', 'CD01B05', 'CD01E12',
    'AB03C08', 'AB03A01', 'AB03D15',
    'EF02B03', 'GH05E01', 'IJ01A06'
  ];

  const sorted = sortLocations([...exampleLocations]);
  const grouped = groupLocationsByRack(exampleLocations);
  const best = suggestBestLocation(exampleLocations);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-800 mb-2">Location Mapping Examples</h1>
        <p className="text-gray-600 text-sm">
          Demonstrating improved location code parsing and display (Format: CD01A02)
        </p>
      </div>

      {/* Interactive Parser */}
      <Card title="🔍 Interactive Location Parser">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Enter Location Code:
            </label>
            <input
              type="text"
              value={testCode}
              onChange={(e) => setTestCode(e.target.value.toUpperCase())}
              className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg font-mono text-lg"
              placeholder="CD01A02"
            />
          </div>

          {parsed.isValid ? (
            <div className="space-y-3 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                ✅ Valid Location Code
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-gray-600">Rack</div>
                  <div className="font-bold text-brand-700 text-lg">{parsed.rack}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Rack Number</div>
                  <div className="font-bold text-gray-700 text-lg">{parsed.rackNumber}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Level</div>
                  <div className="font-bold text-brand-700 text-lg">
                    {parsed.level} ({getLevelName(parsed.level)})
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Position</div>
                  <div className="font-bold text-gray-700 text-lg">{parsed.position}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-emerald-200">
                <div>
                  <div className="text-xs text-gray-600 mb-1">Full Rack</div>
                  <div className="font-mono text-sm">{parsed.fullRack}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Level Height</div>
                  <div className="font-mono text-sm">{parsed.levelHeight} / 5</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Accessibility Score</div>
                  <div className="font-mono text-sm">{getAccessibilityScore(testCode)} / 5</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              ❌ Invalid location format. Expected: 2 letters + 2 digits + 1 letter (A-E) + 2 digits
              <div className="text-xs mt-2">Example: CD01A02</div>
            </div>
          )}
        </div>
      </Card>

      {/* Display Formats */}
      <Card title="🎨 Display Formats">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">Short Format</div>
              <LocationBadge locationCode="CD01A02" format="short" />
              <div className="text-xs text-gray-500 mt-2">Emphasizes Rack-Level (most important)</div>
            </div>
            
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">Full Format</div>
              <LocationBadge locationCode="CD01A02" format="full" />
              <div className="text-xs text-gray-500 mt-2">Shows all components</div>
            </div>
            
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">Detailed Format</div>
              <LocationBadge locationCode="CD01A02" format="detailed" />
              <div className="text-xs text-gray-500 mt-2">Human-readable with descriptions</div>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">With Icons & Level Name</div>
            <LocationBadge locationCode="CD01A02" format="short" showIcon={true} showLevel={true} />
          </div>
        </div>
      </Card>

      {/* Level Color Coding */}
      <Card title="🌈 Level Color Coding">
        <div className="space-y-3">
          {['A', 'B', 'C', 'D', 'E'].map((level) => (
            <div key={level} className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-4">
                <LocationBadge locationCode={`CD01${level}02`} format="short" />
                <div>
                  <div className="font-semibold text-gray-800">Level {level} - {getLevelName(level)}</div>
                  <div className="text-xs text-gray-500">Height: {parseLocation(`CD01${level}02`).levelHeight}/5 • Accessibility: {getAccessibilityScore(`CD01${level}02`)}/5</div>
                </div>
              </div>
              <div className="text-sm text-gray-600">
                {level === 'A' && '🟢 Easiest access'}
                {level === 'B' && '🟢 Easy access'}
                {level === 'C' && '🟡 Moderate access'}
                {level === 'D' && '🟠 Hard access'}
                {level === 'E' && '🔴 Hardest access'}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sorting */}
      <Card title="↕️ Location Sorting">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">Original (unsorted):</div>
            <LocationList locations={exampleLocations} format="short" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">Sorted (Rack → Level → Position):</div>
            <LocationList locations={sorted} format="short" />
          </div>
        </div>
      </Card>

      {/* Grouping */}
      <Card title="📦 Grouping by Rack">
        <div className="space-y-4">
          {Object.entries(grouped).map(([rack, locs]) => (
            <div key={rack} className="border border-gray-200 rounded-lg p-4">
              <div className="text-sm font-bold text-brand-700 mb-3">Rack {rack}</div>
              <LocationList locations={locs} format="full" />
            </div>
          ))}
        </div>
      </Card>

      {/* Smart Suggestion */}
      <Card title="🎯 Smart Location Suggestion">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">Available Locations:</div>
            <LocationList locations={exampleLocations} format="short" />
          </div>
          <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-4">
            <div className="text-sm font-semibold text-emerald-800 mb-2">
              ✨ Suggested Best Location (Lowest level = easiest access):
            </div>
            <LocationBadge locationCode={best || ''} format="detailed" />
          </div>
        </div>
      </Card>

      {/* String Formatting */}
      <Card title="📝 String Formatting Functions">
        <div className="space-y-3 font-mono text-sm">
          <div className="grid grid-cols-2 gap-4 border-b border-gray-200 pb-2">
            <div className="font-semibold text-gray-700">Function</div>
            <div className="font-semibold text-gray-700">Result</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-gray-600">formatLocationDisplay('CD01A02', 'short')</div>
            <div className="font-semibold">{formatLocationDisplay('CD01A02', 'short')}</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-gray-600">formatLocationDisplay('CD01A02', 'full')</div>
            <div className="font-semibold">{formatLocationDisplay('CD01A02', 'full')}</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-gray-600">formatLocationDisplay('CD01A02', 'detailed')</div>
            <div className="font-semibold text-xs">{formatLocationDisplay('CD01A02', 'detailed')}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
