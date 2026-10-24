import {describe,it,expect} from "vitest";
import {resolveCabinetContexts} from "./demo-contexts";

describe("showcase workspace recovery", () => {
  const examples = {manual:"demo-manual",assistant:"demo-assistant"};
  const available = ["demo-manual","demo-assistant","user-manual"];
  it("replaces removed test contexts with existing demo examples", () => {
    expect(resolveCabinetContexts({manual:"old-test",assistant:"deleted-chat"},available,examples)).toEqual(examples);
  });
  it("keeps a visitor's own selection, including a new record not yet returned by the list", () => {
    expect(resolveCabinetContexts({manual:"user-manual",assistant:"just-created"},available,examples,new Set(["just-created"]))).toEqual({manual:"user-manual",assistant:"just-created"});
  });
  it("ignores stale example IDs and never assigns the same application to both workspaces", () => {
    expect(resolveCabinetContexts({manual:null,assistant:null},[],examples)).toEqual({manual:null,assistant:null});
    expect(resolveCabinetContexts({manual:"user-manual",assistant:"user-manual"},available,examples)).toEqual({manual:"user-manual",assistant:"demo-assistant"});
  });
});
