/**
 * CRS CalHacks sandbox personas the app may pull. A request that doesn't match
 * a persona reaches a real bureau vendor and is billable, so only allowlisted,
 * fake sandbox identities are ever sent — and never from browser input.
 *
 * Identity fields below come from the CRS CalHacks Postman collection. SSNs
 * stay out of source and are supplied via CRS_PERSONA_SSN on the server.
 * Changing CRS_TEST_PERSONA selects one of these fixed identities.
 */
export interface SandboxPersona {
  id: string;
  firstName: string;
  lastName: string;
  address: { addressLine1: string; city: string; state: string; postalCode: string };
  /** Expected score when documented by CRS; used only by tests and runbooks. */
  expectedScore?: number;
}

export const SANDBOX_PERSONAS: Record<string, SandboxPersona> = {
  P01: {
    "id": "P01",
    "firstName": "MARGARET",
    "lastName": "OKAFOR",
    "address": {
      "addressLine1": "1420 WILLOW CREEK DR",
      "city": "SAN JOSE",
      "state": "CA",
      "postalCode": "95125"
    }
  },
  P02: {
    "id": "P02",
    "firstName": "DANIEL",
    "lastName": "WHITFIELD",
    "address": {
      "addressLine1": "88 LAKESHORE BLVD",
      "city": "AUSTIN",
      "state": "TX",
      "postalCode": "78746"
    }
  },
  P03: {
    "id": "P03",
    "firstName": "JASMINE",
    "lastName": "REYES",
    "address": {
      "addressLine1": "2210 UNIVERSITY AVE APT 4B",
      "city": "BERKELEY",
      "state": "CA",
      "postalCode": "94704"
    }
  },
  P04: {
    "id": "P04",
    "firstName": "TOMAS",
    "lastName": "LINDQVIST",
    "address": {
      "addressLine1": "415 PINE ST UNIT 12",
      "city": "SEATTLE",
      "state": "WA",
      "postalCode": "98101"
    }
  },
  P05: {
    "id": "P05",
    "firstName": "RICKY",
    "lastName": "DALTON",
    "address": {
      "addressLine1": "7031 SUNSET RIDGE RD",
      "city": "ORLANDO",
      "state": "FL",
      "postalCode": "32819"
    },
    "expectedScore": 540
  },
  P06: {
    "id": "P06",
    "firstName": "ANGELA",
    "lastName": "MORRISSEY",
    "address": {
      "addressLine1": "960 MAPLEWOOD AVE",
      "city": "COLUMBUS",
      "state": "OH",
      "postalCode": "43209"
    }
  },
  P07: {
    "id": "P07",
    "firstName": "MARCUS",
    "lastName": "BELLAMY",
    "address": {
      "addressLine1": "1507 PEACHTREE INDUSTRIAL BLVD",
      "city": "ATLANTA",
      "state": "GA",
      "postalCode": "30341"
    }
  },
  P08: {
    "id": "P08",
    "firstName": "PRIYA",
    "lastName": "VENKATESAN",
    "address": {
      "addressLine1": "3300 N LAKE SHORE DR APT 15C",
      "city": "CHICAGO",
      "state": "IL",
      "postalCode": "60657"
    }
  },
  P09: {
    "id": "P09",
    "firstName": "DEREK",
    "lastName": "HOLLOWAY",
    "address": {
      "addressLine1": "4875 W COLFAX AVE",
      "city": "DENVER",
      "state": "CO",
      "postalCode": "80204"
    }
  },
  P10: {
    "id": "P10",
    "firstName": "LAUREN",
    "lastName": "KOWALCZYK",
    "address": {
      "addressLine1": "1181 WOODWARD AVE",
      "city": "DETROIT",
      "state": "MI",
      "postalCode": "48226"
    }
  },
  P11: {
    "id": "P11",
    "firstName": "BRANDON",
    "lastName": "SZABO",
    "address": {
      "addressLine1": "2640 HIGHLAND AVE APT 7",
      "city": "NATIONAL CITY",
      "state": "CA",
      "postalCode": "91950"
    }
  },
  P12: {
    "id": "P12",
    "firstName": "VICTOR",
    "lastName": "ANAND",
    "address": {
      "addressLine1": "55 WATER ST FL 20",
      "city": "NEW YORK",
      "state": "NY",
      "postalCode": "10041"
    }
  },
  P13: {
    "id": "P13",
    "firstName": "KAYLA",
    "lastName": "BRENNAN",
    "address": {
      "addressLine1": "9021 KINGSTON PIKE",
      "city": "KNOXVILLE",
      "state": "TN",
      "postalCode": "37923"
    }
  },
  P14: {
    "id": "P14",
    "firstName": "HAROLD",
    "lastName": "PETTIGREW",
    "address": {
      "addressLine1": "310 ELM ST",
      "city": "DAYTON",
      "state": "OH",
      "postalCode": "45402"
    }
  },
  P15: {
    "id": "P15",
    "firstName": "NICOLE",
    "lastName": "FARRAGUT",
    "address": {
      "addressLine1": "7700 NE 72ND AVE",
      "city": "PORTLAND",
      "state": "OR",
      "postalCode": "97218"
    }
  },
  P16: {
    "id": "P16",
    "firstName": "SAMUEL",
    "lastName": "OYELARAN",
    "address": {
      "addressLine1": "1200 BRICKELL BAY DR APT 2203",
      "city": "MIAMI",
      "state": "FL",
      "postalCode": "33131"
    }
  },
  P17: {
    "id": "P17",
    "firstName": "ELENA",
    "lastName": "CASTELLANOS",
    "address": {
      "addressLine1": "4400 N CENTRAL EXPY STE 100",
      "city": "DALLAS",
      "state": "TX",
      "postalCode": "75206"
    }
  },
  P18: {
    "id": "P18",
    "firstName": "TERRENCE",
    "lastName": "ABERNATHY",
    "address": {
      "addressLine1": "2102 S HALSTED ST",
      "city": "CHICAGO",
      "state": "IL",
      "postalCode": "60608"
    }
  },
  P19: {
    "id": "P19",
    "firstName": "GRACE",
    "lastName": "NAKAMURA",
    "address": {
      "addressLine1": "1850 SOLANO AVE",
      "city": "BERKELEY",
      "state": "CA",
      "postalCode": "94707"
    }
  },
  P20: {
    "id": "P20",
    "firstName": "DOLORES",
    "lastName": "WHITCOMB",
    "address": {
      "addressLine1": "612 OCEAN VIEW DR",
      "city": "SANTA BARBARA",
      "state": "CA",
      "postalCode": "93109"
    }
  },
};
