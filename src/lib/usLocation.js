// All 50 U.S. states and Washington, DC.
export const US_STATES = [
 ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"]
];
export const RADII=[5,10,15,25,50];
export const locationLabel=(state,city,zip)=>[city,state,zip].filter(Boolean).join(", ")||"United States";
export function locationIssue(state,city,zip){
 if(state&&!US_STATES.some(([code])=>code===state))return "Choose a U.S. state.";
 if(zip&&!/^\d{5}$/.test(zip))return "ZIP codes must contain five digits.";
 if(city&&!state&&!zip)return "Select a state with your city to avoid incorrect matches.";
 return "";
}
