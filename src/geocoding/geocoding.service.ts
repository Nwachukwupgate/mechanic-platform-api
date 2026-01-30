import { Injectable } from '@nestjs/common';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/** Build a street-level address from Nominatim address details (e.g. "21 Main St, Ikeja, Lagos, Nigeria") */
function formatAddressFromDetails(addr: Record<string, string>): string {
  const houseNumber = addr.house_number ?? addr.housenumber ?? '';
  const houseName = addr.house_name ?? addr.house ?? '';
  const road = addr.road ?? addr.street ?? addr.footway ?? addr.path ?? addr.pedestrian ?? '';
  const suburb = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.district ?? addr.borough ?? '';
  const village = addr.village ?? '';
  const town = addr.town ?? '';
  const city = addr.city ?? addr.municipality ?? addr.city_district ?? '';
  const state = addr.state ?? addr.county ?? addr.state_district ?? '';
  const postcode = addr.postcode ?? '';
  const country = addr.country ?? '';

  // Street-level: number + name + road (e.g. "21 Main Street" or "21, Acme Road")
  const streetParts = [houseNumber, houseName, road].filter(Boolean);
  const streetLine = streetParts.length > 0 ? streetParts.join(' ') : '';

  // Locality: suburb/neighbourhood or village/town/city
  const locality = suburb || village || town || city;

  // Build: street, locality, state, postcode, country
  const parts = [streetLine, locality, state, postcode, country].filter(Boolean);
  return parts.join(', ') || '';
}

@Injectable()
export class GeocodingService {
  async reverseGeocode(lat: number, lon: number): Promise<string> {
    // Request building-level detail: zoom=18, layer=address, format=geojson for full address components
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'geojson',
      addressdetails: '1',
      zoom: '18', // building-level when OSM has it
      layer: 'address', // address points (house numbers, streets), not POIs
    });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'MechanicPlatform/1.0 (https://github.com/mechanic-platform)',
      },
    });
    if (!res.ok) throw new Error('Could not get address');
    const data = await res.json();

    // GeoJSON: address is in features[0].properties.address, display_name in features[0].properties.display_name
    const feature = data?.features?.[0];
    const addr = feature?.properties?.address;
    const displayName = feature?.properties?.display_name;

    if (addr && typeof addr === 'object') {
      const formatted = formatAddressFromDetails(addr);
      if (formatted) return formatted;
    }

    return displayName ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}
