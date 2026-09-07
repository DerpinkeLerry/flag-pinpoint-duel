'use strict';

// Stable, curated country pool for gameplay.
//
// world-countries@5.1.0 does not expose a population field. The previous
// implementation treated the missing value as 0 and therefore accidentally
// filtered the pool down to only the explicitly featured small countries.
// Keeping the pool as ISO codes makes game difficulty deterministic and keeps
// it independent from optional metadata fields in third-party packages.
const CURATED_COUNTRY_CODES = Object.freeze([
  'AF', 'AL', 'DZ', 'AO', 'AR', 'AM', 'AU', 'AT', 'AZ',
  'BD', 'BY', 'BE', 'BJ', 'BO', 'BA', 'BW', 'BR', 'BG', 'BF', 'BI',
  'KH', 'CM', 'CA', 'CF', 'TD', 'CL', 'CN', 'CO', 'CG', 'CD', 'CR', 'CI',
  'HR', 'CU', 'CY', 'CZ', 'DK', 'DO',
  'EC', 'EG', 'SV', 'ER', 'EE', 'ET',
  'FI', 'FR',
  'GA', 'GE', 'DE', 'GH', 'GR', 'GT', 'GN',
  'HT', 'HN', 'HU',
  'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IL', 'IT',
  'JM', 'JP', 'JO',
  'KZ', 'KE', 'KP', 'KR', 'KW', 'KG',
  'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LT', 'LU',
  'MG', 'MW', 'MY', 'ML', 'MT', 'MR', 'MX', 'MD', 'MN', 'ME', 'MA', 'MZ', 'MM',
  'NA', 'NP', 'NL', 'NZ', 'NI', 'NE', 'NG', 'MK', 'NO',
  'OM',
  'PK', 'PA', 'PG', 'PY', 'PE', 'PH', 'PL', 'PT', 'QA',
  'RO', 'RU', 'RW',
  'SA', 'SN', 'RS', 'SL', 'SG', 'SK', 'SI', 'SO', 'ZA', 'SS', 'ES', 'LK', 'SD', 'SE', 'CH', 'SY',
  'TW', 'TJ', 'TZ', 'TH', 'TG', 'TN', 'TR', 'TM',
  'UG', 'UA', 'AE', 'GB', 'US', 'UY', 'UZ',
  'VE', 'VN',
  'YE', 'ZM', 'ZW',
]);

const CURATED_COUNTRY_CODE_SET = new Set(CURATED_COUNTRY_CODES);

module.exports = {
  CURATED_COUNTRY_CODES,
  CURATED_COUNTRY_CODE_SET,
};
