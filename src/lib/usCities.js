/* ════════════════════════════════════════════════════════════════
   Bundled U.S. place coordinates for the territory map
   ────────────────────────────────────────────────────────────────
   No geocoding service is called (no cost, no keys, works offline):
     • STATE_CENTROIDS – approximate geographic centre of each state/DC
     • US_CITIES       – ~150 larger cities, approximate city centre
   Coordinates are approximate (map-pin accuracy, not survey accuracy).
   A place that isn't listed is shown at its STATE centre and labelled
   "approximate" — it is never guessed to be in a different state.
   North Carolina cities live in constants.js (NC_CITY_COORDS).
════════════════════════════════════════════════════════════════ */

export const STATE_CENTROIDS = {
  AL:[32.80,-86.79], AK:[63.35,-152.00], AZ:[34.17,-111.93], AR:[34.90,-92.44], CA:[37.18,-119.47],
  CO:[39.00,-105.55], CT:[41.62,-72.73], DE:[38.99,-75.51], DC:[38.91,-77.01], FL:[28.63,-82.45],
  GA:[32.64,-83.44], HI:[20.29,-156.37], ID:[44.35,-114.61], IL:[40.04,-89.20], IN:[39.90,-86.28],
  IA:[42.07,-93.50], KS:[38.49,-98.38], KY:[37.53,-85.30], LA:[31.07,-92.00], ME:[45.37,-69.24],
  MD:[39.05,-76.79], MA:[42.26,-71.81], MI:[44.35,-85.41], MN:[46.28,-94.31], MS:[32.74,-89.67],
  MO:[38.36,-92.46], MT:[47.05,-109.64], NE:[41.53,-99.80], NV:[39.33,-116.63], NH:[43.68,-71.58],
  NJ:[40.19,-74.67], NM:[34.41,-106.11], NY:[42.95,-75.53], NC:[35.55,-79.38], ND:[47.45,-100.47],
  OH:[40.29,-82.79], OK:[35.59,-97.49], OR:[43.94,-120.56], PA:[40.88,-77.80], RI:[41.68,-71.51],
  SC:[33.92,-80.90], SD:[44.44,-100.23], TN:[35.86,-86.35], TX:[31.48,-99.33], UT:[39.31,-111.67],
  VT:[44.07,-72.67], VA:[37.52,-78.85], WA:[47.38,-120.45], WV:[38.64,-80.62], WI:[44.62,-89.99],
  WY:[43.00,-107.55],
};

// City|ST|lat|lon  (parsed once at load)
const RAW = `
New York|NY|40.71|-74.01
Los Angeles|CA|34.05|-118.24
Chicago|IL|41.88|-87.63
Houston|TX|29.76|-95.37
Phoenix|AZ|33.45|-112.07
Philadelphia|PA|39.95|-75.17
San Antonio|TX|29.42|-98.49
San Diego|CA|32.72|-117.16
Dallas|TX|32.78|-96.80
San Jose|CA|37.34|-121.89
Austin|TX|30.27|-97.74
Jacksonville|FL|30.33|-81.66
Fort Worth|TX|32.75|-97.33
Columbus|OH|39.96|-83.00
Indianapolis|IN|39.77|-86.16
San Francisco|CA|37.77|-122.42
Seattle|WA|47.61|-122.33
Denver|CO|39.74|-104.99
Washington|DC|38.91|-77.04
Boston|MA|42.36|-71.06
El Paso|TX|31.76|-106.49
Nashville|TN|36.16|-86.78
Detroit|MI|42.33|-83.05
Oklahoma City|OK|35.47|-97.52
Portland|OR|45.52|-122.68
Las Vegas|NV|36.17|-115.14
Memphis|TN|35.15|-90.05
Louisville|KY|38.25|-85.76
Baltimore|MD|39.29|-76.61
Milwaukee|WI|43.04|-87.91
Albuquerque|NM|35.08|-106.65
Tucson|AZ|32.22|-110.97
Fresno|CA|36.74|-119.79
Sacramento|CA|38.58|-121.49
Kansas City|MO|39.10|-94.58
Atlanta|GA|33.75|-84.39
Omaha|NE|41.26|-95.93
Colorado Springs|CO|38.83|-104.82
Miami|FL|25.76|-80.19
Virginia Beach|VA|36.85|-75.98
Oakland|CA|37.80|-122.27
Minneapolis|MN|44.98|-93.27
Tulsa|OK|36.15|-95.99
Tampa|FL|27.95|-82.46
Arlington|TX|32.74|-97.11
New Orleans|LA|29.95|-90.07
Wichita|KS|37.69|-97.34
Cleveland|OH|41.50|-81.69
Bakersfield|CA|35.37|-119.02
Aurora|CO|39.73|-104.83
Anaheim|CA|33.84|-117.91
Honolulu|HI|21.31|-157.86
Riverside|CA|33.95|-117.40
Corpus Christi|TX|27.80|-97.40
Lexington|KY|38.04|-84.50
Stockton|CA|37.96|-121.29
Saint Paul|MN|44.95|-93.09
Cincinnati|OH|39.10|-84.51
Saint Louis|MO|38.63|-90.20
Pittsburgh|PA|40.44|-79.99
Lincoln|NE|40.81|-96.70
Anchorage|AK|61.22|-149.90
Plano|TX|33.02|-96.70
Orlando|FL|28.54|-81.38
Irvine|CA|33.68|-117.83
Newark|NJ|40.74|-74.17
Toledo|OH|41.65|-83.54
Fort Wayne|IN|41.08|-85.14
Saint Petersburg|FL|27.77|-82.64
Jersey City|NJ|40.72|-74.04
Madison|WI|43.07|-89.40
Lubbock|TX|33.58|-101.86
Scottsdale|AZ|33.49|-111.93
Reno|NV|39.53|-119.81
Buffalo|NY|42.89|-78.88
Chandler|AZ|33.31|-111.84
Norfolk|VA|36.85|-76.29
Richmond|VA|37.54|-77.44
Boise|ID|43.62|-116.20
Spokane|WA|47.66|-117.43
Baton Rouge|LA|30.45|-91.15
Des Moines|IA|41.59|-93.62
Tacoma|WA|47.25|-122.44
Birmingham|AL|33.52|-86.80
Rochester|NY|43.16|-77.61
Salt Lake City|UT|40.76|-111.89
Providence|RI|41.82|-71.41
Hartford|CT|41.76|-72.67
Charleston|SC|32.78|-79.93
Columbia|SC|34.00|-81.03
Greenville|SC|34.85|-82.40
Savannah|GA|32.08|-81.09
Knoxville|TN|35.96|-83.92
Chattanooga|TN|35.05|-85.31
Little Rock|AR|34.75|-92.29
Jackson|MS|32.30|-90.18
Mobile|AL|30.69|-88.04
Montgomery|AL|32.38|-86.30
Akron|OH|41.08|-81.52
Dayton|OH|39.76|-84.19
Grand Rapids|MI|42.96|-85.67
Albany|NY|42.65|-73.76
Syracuse|NY|43.05|-76.15
Manchester|NH|42.99|-71.46
Portland|ME|43.66|-70.26
Burlington|VT|44.48|-73.21
Wilmington|DE|39.74|-75.55
Charleston|WV|38.35|-81.63
Fargo|ND|46.88|-96.79
Sioux Falls|SD|43.54|-96.73
Billings|MT|45.78|-108.50
Cheyenne|WY|41.14|-104.82
Santa Fe|NM|35.69|-105.94
Columbus|GA|32.46|-84.99
Henderson|NV|36.04|-114.98
Long Beach|CA|33.77|-118.19
Tallahassee|FL|30.44|-84.28
Fort Lauderdale|FL|26.12|-80.14
Salem|OR|44.94|-123.04
Eugene|OR|44.05|-123.09
Boulder|CO|40.01|-105.27
Fort Collins|CO|40.59|-105.08
Provo|UT|40.23|-111.66
Mesa|AZ|33.42|-111.83
Tempe|AZ|33.43|-111.94
Overland Park|KS|38.98|-94.67
Topeka|KS|39.05|-95.68
Springfield|MO|37.21|-93.29
Springfield|IL|39.78|-89.65
Ann Arbor|MI|42.28|-83.74
Lansing|MI|42.73|-84.56
Green Bay|WI|44.52|-88.02
Duluth|MN|46.79|-92.10
Cedar Rapids|IA|41.98|-91.67
Shreveport|LA|32.53|-93.75
Lafayette|LA|30.22|-92.02
Huntsville|AL|34.73|-86.59
Roanoke|VA|37.27|-79.94
Alexandria|VA|38.80|-77.05
Bridgeport|CT|41.19|-73.20
New Haven|CT|41.31|-72.92
Worcester|MA|42.26|-71.80
Allentown|PA|40.60|-75.47
Harrisburg|PA|40.27|-76.88
Trenton|NJ|40.22|-74.76
Augusta|GA|33.47|-81.97
Gainesville|FL|29.65|-82.32
Pensacola|FL|30.42|-87.22
Fort Myers|FL|26.64|-81.87
West Palm Beach|FL|26.72|-80.05
McAllen|TX|26.20|-98.23
Waco|TX|31.55|-97.15
Amarillo|TX|35.22|-101.83
Fayetteville|AR|36.06|-94.16
Murfreesboro|TN|35.85|-86.39
Lawrence|KS|38.97|-95.24
Missoula|MT|46.87|-114.00
Juneau|AK|58.30|-134.42
`;

const norm = s => String(s).toLowerCase().replace(/\bsaint\b/g, "st").replace(/\bst\.?\s/g, "st ").replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
export const cityKey = (city, state) => `${norm(city)}|${String(state).toUpperCase()}`;

export const US_CITIES = new Map();
export const CITY_ROWS = [];
for (const line of RAW.trim().split("\n")){
  const [city, st, lat, lon] = line.split("|");
  US_CITIES.set(cityKey(city, st), [Number(lat), Number(lon)]);
  CITY_ROWS.push({ city, state: st, coords: [Number(lat), Number(lon)] });
}
