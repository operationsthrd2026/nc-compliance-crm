/* HR evidence from a job title (pure).
   Returns "Yes" only when the title itself shows an HR/people role; otherwise "Unknown".
   NEVER returns "No": a person's title can't prove an organisation has no HR contact.
   (The old test, /hr|human resources|people|talent/i, also matched words like "Three",
   "Chris" and "Shrink", and any title containing "people".) */
const HR_TITLE = /\b(?:hr|h\.r\.|human\s+resources?|people\s+(?:operations|ops|partner|officer|team|and\s+culture|&\s*culture)|chief\s+people|talent\s+(?:acquisition|management|partner|officer)|head\s+of\s+(?:hr|people|talent))\b/i;

export function hrFromTitle(title){ return HR_TITLE.test(String(title ?? "")) ? "Yes" : "Unknown"; }
