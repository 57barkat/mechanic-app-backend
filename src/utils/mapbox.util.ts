import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

if (!MAPBOX_TOKEN) {
  throw new Error("MAPBOX_TOKEN is not defined in environment variables");
}

/**
 * Validate latitude & longitude
 */
const validateCoordinates = (lat: number, lng: number) => {
  if (typeof lat !== "number" || typeof lng !== "number") {
    throw new Error("Latitude and longitude must be numbers");
  }

  if (lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude: ${lat}`);
  }

  if (lng < -180 || lng > 180) {
    throw new Error(`Invalid longitude: ${lng}`);
  }
};

/**
 * start = [latitude, longitude]
 * end   = [latitude, longitude]
 */
export const getRoute = async (
  start: [number, number],
  end: [number, number]
) => {
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;

  // ✅ Validate coordinates before calling Mapbox
  validateCoordinates(startLat, startLng);
  validateCoordinates(endLat, endLng);

  // ✅ Mapbox requires: longitude,latitude
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${startLng},${startLat};${endLng},${endLat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

  try {
    const response = await axios.get(url);

    if (!response.data || response.data.routes.length === 0) {
      throw new Error("No routes found from Mapbox");
    }

    return response.data;
  } catch (error: any) {
    console.error("Mapbox Error:", error.response?.data || error.message);
    throw new Error("Mapbox routing failed");
  }
};
