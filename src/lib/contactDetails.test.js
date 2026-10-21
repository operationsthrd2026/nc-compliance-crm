import test from "node:test";
import assert from "node:assert/strict";
import {safeWebsite,safeOrganizationWebsite,safeEmail,safePhone,publicDetailsFromOsm,publicDetailsFromApollo} from "./contactDetails.js";

test("legitimate website is retained and invalid source/profile is not treated as a website",()=>{
 assert.equal(safeWebsite("example.org"),"https://example.org/");
 assert.equal(safeWebsite("https://example.org/about"),"https://example.org/about");
 assert.equal(safeWebsite("javascript:alert(1)"),"");
 assert.equal(safeWebsite("http://localhost/admin"),"");
 assert.equal(safeWebsite("https://example.org bad.com"),"");
});
test("OSM contact tags map to independent official website, email and phone fields",()=>{
 assert.deepEqual(publicDetailsFromOsm({"contact:website":"https://clinic.example.org","contact:email":"office@clinic.example.org","phone":"+1 (202) 555-0123"}),{
  website:"https://clinic.example.org/",email:"office@clinic.example.org",phone:"+1 (202) 555-0123"
 });
 assert.deepEqual(publicDetailsFromOsm({}),{website:"",email:"",phone:""});
});
test("emails and phone numbers are never invented",()=>{
 assert.equal(safeEmail("unlisted"),"");
 assert.equal(safePhone("unknown"),"");
 assert.equal(safeEmail("info@sample.org"),"info@sample.org");
});
test("Apollo organization metadata does not fabricate contact details",()=>{
 assert.deepEqual(publicDetailsFromApollo({primary_domain:"example.com"}),{website:"https://example.com/",email:"",phone:""});
});

test("social and source directory profiles are not organization websites",()=>{
 assert.equal(safeOrganizationWebsite("https://www.facebook.com/example"),"");
 assert.equal(safeOrganizationWebsite("https://projects.propublica.org/nonprofits/organizations/123"),"");
 assert.equal(safeOrganizationWebsite("https://example.org/"),"https://example.org/");
});
