const sinon = require("sinon");
const core = require("@actions/core");
const lib = require("../lib");

const sandbox = sinon.createSandbox();

describe("lib.loginToAllRegistries", () => {
  beforeEach(() => {
    sandbox.restore();
  });

  after(() => {
    sandbox.restore();
  });

  it("always logs into primary registry");

  it("asserts and logs into all other provided registries");

  it("returns additional docker build args and hosts");
});
