# Listing Schema

## Key Design Choice

A single Facebook post may contain **multiple housing offerings**.

So the pipeline should support:
- one source post
- many extracted listing records

## Normalized Listing Object

```json
{
  "source": {
    "platform": "facebook",
    "groupName": "string | null",
    "postUrl": "string | null",
    "postId": "string | null",
    "authorName": "string | null",
    "capturedAt": "ISO timestamp",
    "postedAtText": "string | null",
    "captureMethod": "dom | snapshot | null",
    "captureRunId": "string | null",
    "rawArtifactPath": "string | null"
  },
  "listingType": "entire_apartment | room_in_shared | multiple_rooms_in_shared | sublet | lease_takeover | roommate_search | short_term | unknown",
  "location": {
    "rawText": "string | null",
    "address": "string | null",
    "neighborhood": "string | null",
    "borough": "Manhattan | Brooklyn | Queens | Bronx | Staten Island | null",
    "city": "New York | null",
    "state": "NY | null",
    "lat": null,
    "lng": null,
    "geocodeConfidence": null
  },
  "pricing": {
    "amount": null,
    "currency": "USD",
    "period": "month | week | night | unknown",
    "deposit": null,
    "brokerFee": null,
    "utilitiesIncluded": null
  },
  "rooms": {
    "roomsAvailable": null,
    "totalBedrooms": null,
    "bathrooms": null,
    "occupancyNotes": null
  },
  "dates": {
    "availableFrom": null,
    "availableTo": null,
    "leaseTermText": null
  },
  "features": {
    "petsAllowed": null,
    "laundry": null,
    "furnished": null,
    "privateBath": null,
    "outdoorSpace": null,
    "doorman": null,
    "elevator": null
  },
  "contact": {
    "contactMethod": null,
    "contactValue": null
  },
  "notes": {
    "summary": "string",
    "rawSignals": [],
    "ambiguities": []
  },
  "confidence": {
    "overall": 0,
    "fields": {}
  }
}
```

## Notes

- Preserve raw evidence alongside normalized fields.
- Unknown is better than fake certainty.
- Room counts should distinguish total apartment size from rooms actually available.
- Listing type should be derived from evidence, not just a single keyword.
- The active DOM path now builds listings from canonical collected posts, then copies source metadata into each extracted listing.
