import {describe,it,expect} from "vitest";
import guide from "../../public/project-docs/guide.md?raw";
import {documentationGroups,parseGuide} from "./documentation-model";
describe("documentation navigation",()=>{
 it("gives every chapter exactly one navigation entry and a stable unique anchor",()=>{
  const sections=parseGuide(guide),ids=sections.map(section=>section.id),links=documentationGroups.flatMap(group=>group.ids);
  expect(sections.length).toBe(30);expect(new Set(ids).size).toBe(ids.length);expect(links.toSorted()).toEqual(ids.toSorted());
  expect(sections.every(section=>section.body.length>150)).toBe(true);
 });
 it("does not accept duplicate anchors that would navigate to the wrong chapter",()=>{
  expect(()=>parseGuide("## A {#start}\nText\n## B {#start}\nOther")).toThrow("Duplicate");
 });
});
