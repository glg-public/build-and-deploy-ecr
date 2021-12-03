const sinon = require("sinon");
const core = require("@actions/core");
const lib = require("../lib");
const { ECRClient } = require("@aws-sdk/client-ecr");
const { expect } = require("chai");

const sandbox = sinon.createSandbox();

let loginStub, assertStub;

const client = {
  send: async () => {},
};

const ecrRepository = "somerepo";
const sha = "abcdefg";

describe("lib.loginToAllRegistries", () => {
  beforeEach(() => {
    sandbox.restore();
    loginStub = sandbox.stub(lib.util, "dockerLogin").resolves();
    assertStub = sandbox.stub(lib.util, "assertECRRepo").resolves();
  });

  after(() => {
    sandbox.restore();
  });

  it("always logs into primary registry", async () => {
    const inputs = {
      ecrURI: "someuri",
    };

    const { dockerBuildArgs, hosts } = await lib.loginToAllRegistries(
      client,
      inputs,
      ecrRepository,
      sha
    );

    // We will have logged into the primary registry, but
    // nothing else
    expect(loginStub.callCount).to.equal(1);
    expect(loginStub.getCall(0).args).to.deep.equal([client, inputs.ecrURI]);
    expect(dockerBuildArgs).to.be.empty;
    expect(hosts).to.be.empty;
  });

  it("splits registries on comma if there is a comma", async () => {
    const inputs = {
      ecrURI: "someuri",
      registries: "aws://user:pass@someuri2,aws://user:pass@someuri3",
    };

    await lib.loginToAllRegistries(client, inputs, ecrRepository, sha);

    // 3 total registries were specified
    expect(loginStub.callCount).to.equal(3);

    // Asserts and logs in the first extra registry
    expect(assertStub.getCall(0).args[0]).to.be.an.instanceOf(ECRClient);
    expect(assertStub.getCall(0).args[1]).to.equal(ecrRepository);
    expect(loginStub.getCall(1).args[0]).to.be.an.instanceOf(ECRClient);
    expect(loginStub.getCall(1).args[1]).to.equal("someuri2");

    // Asserts and logs in the second extra registry
    expect(assertStub.getCall(1).args[0]).to.be.an.instanceOf(ECRClient);
    expect(assertStub.getCall(1).args[1]).to.equal(ecrRepository);
    expect(loginStub.getCall(2).args[0]).to.be.an.instanceOf(ECRClient);
    expect(loginStub.getCall(2).args[1]).to.equal("someuri3");
  });

  it("splits registries on newline if no comma", async () => {
    const inputs = {
      ecrURI: "someuri",
      registries: "aws://user:pass@someuri2\naws://user:pass@someuri3",
    };

    await lib.loginToAllRegistries(client, inputs, ecrRepository, sha);

    // 3 total registries were specified
    expect(loginStub.callCount).to.equal(3);

    // Asserts and logs in the first extra registry
    expect(assertStub.getCall(0).args[0]).to.be.an.instanceOf(ECRClient);
    expect(assertStub.getCall(0).args[1]).to.equal(ecrRepository);
    expect(loginStub.getCall(1).args[0]).to.be.an.instanceOf(ECRClient);
    expect(loginStub.getCall(1).args[1]).to.equal("someuri2");

    // Asserts and logs in the second extra registry
    expect(assertStub.getCall(1).args[0]).to.be.an.instanceOf(ECRClient);
    expect(assertStub.getCall(1).args[1]).to.equal(ecrRepository);
    expect(loginStub.getCall(2).args[0]).to.be.an.instanceOf(ECRClient);
    expect(loginStub.getCall(2).args[1]).to.equal("someuri3");
  });

  it("returns additional docker build args and hosts", async () => {
    const inputs = {
      ecrURI: "someuri",
      registries: "aws://user:pass@someuri2\naws://user:pass@someuri3",
    };

    const { dockerBuildArgs, hosts } = await lib.loginToAllRegistries(
      client,
      inputs,
      ecrRepository,
      sha
    );

    expect(
      dockerBuildArgs.includesInOrder(
        "--tag",
        `someuri2/${ecrRepository}:latest`,
        "--tag",
        `someuri2/${ecrRepository}:${sha}`
      )
    ).to.be.true;

    expect(
      dockerBuildArgs.includesInOrder(
        "--tag",
        `someuri3/${ecrRepository}:latest`,
        "--tag",
        `someuri3/${ecrRepository}:${sha}`
      )
    ).to.be.true;

    expect(hosts).to.include.members(["someuri2", "someuri3"]);
  });
});
