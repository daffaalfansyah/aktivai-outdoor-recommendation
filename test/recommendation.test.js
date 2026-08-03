const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractCurrentFeatures,
  extractHourlyFeatures,
  normalizeFeatures,
  trimRecommendations,
} = require('../server.js');

test('normalizeFeatures keeps the model training feature order values', () => {
  const features = normalizeFeatures({
    temperature: '29.5',
    humidity: '71',
    precipitation: '0.2',
    wind_speed: '12',
    aqi: '84',
    pm25: '20',
    pm10: '40',
    environment: 'Urban',
  });

  assert.deepEqual(Object.keys(features), [
    'temperature',
    'humidity',
    'precipitation',
    'wind_speed',
    'aqi',
    'pm25',
    'pm10',
    'environment',
  ]);
  assert.equal(features.temperature, 29.5);
  assert.equal(features.aqi, 84);
  assert.equal(features.environment, 'Urban');
});

test('extractCurrentFeatures reads weather and air-quality payloads', () => {
  const features = extractCurrentFeatures({
    place: {
      name: 'Taman Mini',
      region: {
        raw: { amenity: 'park' }
      }
    },
    forecast: {
      current: {
        time: '2026-07-14T12:00',
        temperature_2m: 31,
        relative_humidity_2m: 65,
        precipitation: 0,
        wind_speed_10m: 9,
      },
    },
    air: {
      current: {
        us_aqi: 77,
        pm2_5: 18,
        pm10: 35,
      },
    },
  });

  assert.equal(features.temperature, 31);
  assert.equal(features.humidity, 65);
  assert.equal(features.precipitation, 0);
  assert.equal(features.wind_speed, 9);
  assert.equal(features.aqi, 77);
  assert.equal(features.pm25, 18);
  assert.equal(features.pm10, 35);
  assert.equal(features.environment, 'Park');
});

test('extractHourlyFeatures maps every hourly slot for ML scoring', () => {
  const hourly = extractHourlyFeatures({
    place: {
      name: 'Kali Adem',
      region: {
        raw: { natural: 'water' }
      }
    },
    forecast: {
      hourly: {
        time: ['2026-07-14T08:00', '2026-07-14T21:00'],
        temperature_2m: [28, 30],
        relative_humidity_2m: [70, 68],
        precipitation: [0, 0.1],
        wind_speed_10m: [7, 8],
      },
    },
    air: {
      hourly: {
        us_aqi: [55, 60],
        pm2_5: [12, 14],
        pm10: [22, 25],
      },
    },
  });

  assert.equal(hourly.length, 2);
  assert.equal(hourly[0].temperature, 28);
  assert.equal(hourly[0].environment, 'Water'); // 08:00 is daytime Water
  assert.equal(hourly[1].environment, 'Night'); // 21:00 is nighttime Night
});

test('trimRecommendations returns at least five highest-confidence activities', () => {
  const recommendations = trimRecommendations([
    { activity: 'Jogging', confidence: 70 },
    { activity: 'Yoga outdoor', confidence: 83 },
    { activity: 'Jalan santai', confidence: 91 },
    { activity: 'Bersepeda santai', confidence: 20 },
    { activity: 'Family outing', confidence: 55 },
    { activity: 'Fishing', confidence: 44 },
  ]);

  assert.equal(recommendations.length, 5);
  assert.equal(recommendations[0].activity, 'Jalan santai');
  assert.equal(recommendations[0].confidence, 91);
});

test('extractCurrentFeatures maps environment correctly for various places', () => {
  const testPlaces = [
    { name: 'Pantai Kuta', raw: {}, expected: 'Water' },
    { name: 'Danau Toba', raw: {}, expected: 'Water' },
    { name: 'Waduk Jatiluhur', raw: {}, expected: 'Water' },
    { name: 'Monas', raw: {}, expected: 'Urban' },
    { name: 'Taman Suropati', raw: {}, expected: 'Park' },
    { name: 'Gunung Gede', raw: {}, expected: 'Nature' },
  ];

  testPlaces.forEach(({ name, raw, expected }) => {
    const features = extractCurrentFeatures({
      place: {
        name,
        region: { raw }
      },
      forecast: {
        current: {
          time: '2026-07-14T12:00',
          temperature_2m: 28,
        }
      }
    });
    assert.equal(features.environment, expected, `Place: ${name} should be classified as ${expected}`);
  });
});
