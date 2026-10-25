/**
 * The five dataset items from the one live test run of `skootle/cars-com-scraper`
 * (run fW2UhtNyQQmOJGGL9, dataset euv8rzUeFGab2j4Xi, 2026-10-25): Toyota Corolla,
 * ZIP 95823, 50 miles, $17,000, 2017+, 100,000 miles, USED, 5 items.
 * Copied as returned, minus photos, the agent summary, colors, and the
 * dealer phone and street address. Note the run's quirks: string `price` and
 * `mileage` beside the numeric fields, null MPG on the 2017 XLE, and a wrong
 * "Rear-wheel Drive" on two Corollas.
 */
export const CARS_COM_RUN_ITEMS: Record<string, unknown>[] = [
  {
    "listingId": "634e578b-91e9-4aea-b83e-97f19b709eeb",
    "listingUrl": "https://www.cars.com/vehicledetail/634e578b-91e9-4aea-b83e-97f19b709eeb/",
    "vin": "5YFEPMAE3MP147475",
    "year": 2021,
    "make": "Toyota",
    "model": "Corolla",
    "trim": "LE",
    "bodyStyle": "Sedan",
    "drivetrain": "Rear-wheel Drive",
    "fuelType": "Gasoline",
    "mpgCity": 30,
    "mpgHighway": 38,
    "price": "16998",
    "priceUsd": 16998,
    "mileage": "97590",
    "mileageMiles": 97590,
    "listedAt": "2026-09-17T19:03:23",
    "dealer": {
      "name": "CarMax Sacramento/Roseville",
      "city": "Roseville",
      "state": "CA",
      "zip": "95661",
      "lat": 38.75309,
      "lon": -121.2539,
      "distanceMi": null
    }
  },
  {
    "listingId": "b54098ec-4235-4957-a245-ffe2b3da5b71",
    "listingUrl": "https://www.cars.com/vehicledetail/b54098ec-4235-4957-a245-ffe2b3da5b71/",
    "vin": "5YFBURHE7HP631671",
    "year": 2017,
    "make": "Toyota",
    "model": "Corolla",
    "trim": "L",
    "bodyStyle": "Sedan",
    "drivetrain": "Rear-wheel Drive",
    "fuelType": "Gasoline",
    "mpgCity": 28,
    "mpgHighway": 36,
    "price": "15998",
    "priceUsd": 15998,
    "mileage": "98223",
    "mileageMiles": 98223,
    "listedAt": "2026-10-24T18:13:01",
    "dealer": {
      "name": "CarMax Stockton",
      "city": "Stockton",
      "state": "CA",
      "zip": "95212",
      "lat": 38.02095,
      "lon": -121.26595,
      "distanceMi": null
    }
  },
  {
    "listingId": "9fa616ce-2112-42dc-9c50-a6da82ecfb2a",
    "listingUrl": "https://www.cars.com/vehicledetail/9fa616ce-2112-42dc-9c50-a6da82ecfb2a/",
    "vin": "5YFBURHE5HP723507",
    "year": 2017,
    "make": "Toyota",
    "model": "Corolla",
    "trim": "XLE",
    "bodyStyle": "Sedan",
    "drivetrain": "Front-wheel Drive",
    "fuelType": "Gasoline",
    "mpgCity": null,
    "mpgHighway": null,
    "price": "16903",
    "priceUsd": 16903,
    "mileage": "65000",
    "mileageMiles": 65000,
    "listedAt": "2026-10-03T14:00:45",
    "dealer": {
      "name": "Choice Auto ' N ' Truck",
      "city": "Sacramento",
      "state": "CA",
      "zip": "95825",
      "lat": 38.60652,
      "lon": -121.40205,
      "distanceMi": null
    }
  },
  {
    "listingId": "e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4",
    "listingUrl": "https://www.cars.com/vehicledetail/e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4/",
    "vin": "5YFEPRAE4LP030872",
    "year": 2020,
    "make": "Toyota",
    "model": "Corolla",
    "trim": "LE",
    "bodyStyle": "Sedan",
    "drivetrain": "Front-wheel Drive",
    "fuelType": "Gasoline",
    "mpgCity": 30,
    "mpgHighway": 38,
    "price": "14860",
    "priceUsd": 14860,
    "mileage": "83705",
    "mileageMiles": 83705,
    "listedAt": "2026-10-02T10:41:10",
    "dealer": {
      "name": "National Autos Sales",
      "city": "Sacramento",
      "state": "CA",
      "zip": "95823",
      "lat": 38.49585,
      "lon": -121.46188,
      "distanceMi": null
    }
  },
  {
    "listingId": "05fc4168-9d31-4449-bb25-581f389413e8",
    "listingUrl": "https://www.cars.com/vehicledetail/05fc4168-9d31-4449-bb25-581f389413e8/",
    "vin": "5YFBURHE3KP898913",
    "year": 2019,
    "make": "Toyota",
    "model": "Corolla",
    "trim": "LE",
    "bodyStyle": "Sedan",
    "drivetrain": "Front-wheel Drive",
    "fuelType": "Gasoline",
    "mpgCity": 28,
    "mpgHighway": 36,
    "price": "15588",
    "priceUsd": 15588,
    "mileage": "79067",
    "mileageMiles": 79067,
    "listedAt": "2026-08-07T11:00:43",
    "dealer": {
      "name": "Thrifty Car Sales",
      "city": "Sacramento",
      "state": "CA",
      "zip": "95823",
      "lat": 38.49594,
      "lon": -121.43949,
      "distanceMi": null
    }
  }
];
