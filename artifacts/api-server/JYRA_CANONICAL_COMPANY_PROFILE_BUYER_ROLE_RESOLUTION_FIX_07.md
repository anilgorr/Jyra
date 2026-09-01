# JYRA Canonical Company Profile + Buyer Role Resolution Fix 07

- Checkpoints: realityTestEnvForbidden=true, identitySafeFirmographicsPath=true, onlyIncompleteProfilesAttempted=true, buyerRolesRecomputed=true
- Cohort: 18; confirmed profiles: 0; still UNKNOWN: 18; wrong profiles: 0
- Role counts: {"POTENTIAL_BUYER":0,"SELLER_COMPETITOR":0,"ADJACENT_VENDOR":0,"PARTNER_POSSIBLE":0,"UNKNOWN":18}
- WHO counts: {"LIKELY_FIT":0,"POSSIBLE_FIT":0,"LIKELY_NOT_FIT":0,"INSUFFICIENT_DATA":18}
- Provider summary: {"profileResolution":{"calls":22,"estimatedCost":0.15400000000000008,"actualCost":0.3250000000000002},"firmographics":{"calls":7,"estimatedCost":0.010499999999999999,"actualCost":null}}

```json
[
  {
    "company": "King Operating Corporation",
    "domain": "kingoperating.com",
    "profileCompleteness": 0.6666666666666666,
    "unknownFields": [
      "industry",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_INDUSTRY_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "NOT_ATTEMPTED",
    "firmographicsStatus": "CONFIRMED",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Cypress Operating Inc",
    "domain": "cypressop.com",
    "profileCompleteness": 0.6666666666666666,
    "unknownFields": [
      "size",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_SIZE_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "NOT_ATTEMPTED",
    "firmographicsStatus": "CONFIRMED",
    "canonicalIndustry": "Manufacturing",
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "CData Virtuality",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "PROBABLE",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Madlabs Global LLC",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "AMBIGUOUS",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Vyntra Global - Transaction Observability",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "AMBIGUOUS",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "J H Operating Company",
    "domain": "jheandp.com",
    "profileCompleteness": 0.6666666666666666,
    "unknownFields": [
      "industry",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_INDUSTRY_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "NOT_ATTEMPTED",
    "firmographicsStatus": "CONFIRMED",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "3LOCKS",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "WRONG",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Cyber Security Operations",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "AMBIGUOUS",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "First Horizon Commercial & Specialty Banking",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "WRONG",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "IBERIABANK",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "PROBABLE",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Juntos Global",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "PROBABLE",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Netcordia, Inc.",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "PROBABLE",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Oprion",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "AMBIGUOUS",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Secov",
    "domain": null,
    "profileCompleteness": 0,
    "unknownFields": [
      "identity",
      "industry",
      "size",
      "geography",
      "description",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_IDENTITY_MISSING,PROFILE_INDUSTRY_MISSING,PROFILE_SIZE_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_DESCRIPTION_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "AMBIGUOUS",
    "firmographicsStatus": "empty",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Team Operating, LLC",
    "domain": "teamoperating.com",
    "profileCompleteness": 0.6666666666666666,
    "unknownFields": [
      "industry",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_INDUSTRY_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "NOT_ATTEMPTED",
    "firmographicsStatus": "CONFIRMED",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Andes Operating Company",
    "domain": "andesoperating.com",
    "profileCompleteness": 0.5,
    "unknownFields": [
      "industry",
      "geography",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_INDUSTRY_MISSING,PROFILE_GEOGRAPHY_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "NOT_ATTEMPTED",
    "firmographicsStatus": "CONFIRMED",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "K&R Operating LLC.",
    "domain": "krollc.com",
    "profileCompleteness": 0.8333333333333334,
    "unknownFields": [
      "businessModel"
    ],
    "autopsyReason": "PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "NOT_ATTEMPTED",
    "firmographicsStatus": "CONFIRMED",
    "canonicalIndustry": "Professional Services",
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  },
  {
    "company": "Jetta Operating Company, Inc.",
    "domain": "jettaoperating.com",
    "profileCompleteness": 0.6666666666666666,
    "unknownFields": [
      "industry",
      "businessModel"
    ],
    "autopsyReason": "PROFILE_INDUSTRY_MISSING,PROFILE_BUSINESSMODEL_MISSING",
    "resolutionStatus": "NOT_ATTEMPTED",
    "firmographicsStatus": "CONFIRMED",
    "canonicalIndustry": null,
    "businessModel": "UNKNOWN",
    "buyerRole": "UNKNOWN",
    "buyerRoleConfidence": "LOW",
    "who": "INSUFFICIENT_DATA"
  }
]
```
