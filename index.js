const { NgrokClient, NgrokClientError } = require("./src/client");
const uuid = require("uuid");
const {
  getProcess,
  getActiveProcess,
  killProcess,
  setAuthtoken,
  getVersion,
} = require("./src/process");
const { defaults, validate, isRetriable } = require("./src/utils");

let processUrl = null;
let ngrokClient = null;

async function connect(opts) {
  opts = defaults(opts);
  validate(opts);
  if (opts.authtoken) {
    await setAuthtoken(opts);
  }
  const masked = opts.authtoken
    ? opts.authtoken.slice(0, 4) + "..." + opts.authtoken.slice(-4)
    : "none";
  console.log("[clary][expo-ngrok] using authtoken:", masked);

  processUrl = await getProcess(opts);
  console.log(
    "[clary][expo-ngrok] ngrok process started, API URL:",
    processUrl,
  );
  ngrokClient = new NgrokClient(processUrl);
  return connectRetry(opts);
}

async function connectRetry(opts, retryCount = 0) {
  opts.name = String(opts.name || uuid.v4());
  // Strip process-level fields that aren't valid tunnel configuration in ngrok v3+
  const {
    authtoken,
    configPath,
    port,
    region,
    onLogEvent,
    onStatusChange,
    web_addr,
    host,
    httpauth,
    ...tunnelOpts
  } = opts;
  try {
    const response = await ngrokClient.startTunnel(tunnelOpts);
    return response.public_url;
  } catch (err) {
    const alreadyExists =
      err.response?.statusCode === 400 &&
      err.body?.details?.err?.includes("already exists");
    if (alreadyExists) {
      try {
        const existing = await ngrokClient.tunnelDetail(tunnelOpts.name);
        return existing.public_url;
      } catch (_) {
        opts.name = uuid.v4();
        return connectRetry(opts, retryCount + 1);
      }
    }
    const retriable = isRetriable(err);
    if (!retriable || retryCount >= 100) {
      console.error(
        "[clary][expo-ngrok] tunnel creation failed:",
        `statusCode=${err.response?.statusCode}`,
        `body=${JSON.stringify(err.body)}`,
        err.message,
      );
      throw err;
    }
    if (retryCount === 0) {
      console.log("[clary][expo-ngrok] waiting for ngrok tunnel session...");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return connectRetry(opts, ++retryCount);
  }
}

async function disconnect(publicUrl) {
  if (!ngrokClient) return;
  const tunnels = (await ngrokClient.listTunnels()).tunnels;
  if (!publicUrl) {
    const disconnectAll = tunnels.map((tunnel) =>
      disconnect(tunnel.public_url),
    );
    return Promise.all(disconnectAll);
  }
  const tunnelDetails = tunnels.find(
    (tunnel) => tunnel.public_url === publicUrl,
  );
  if (!tunnelDetails) {
    throw new Error(`there is no tunnel with url: ${publicUrl}`);
  }
  return ngrokClient.stopTunnel(tunnelDetails.name);
}

async function kill() {
  if (!ngrokClient) return;
  await killProcess();
  ngrokClient = null;
  tunnels = {};
}

function getUrl() {
  return processUrl;
}

function getApi() {
  return ngrokClient;
}

module.exports = {
  connect,
  disconnect,
  authtoken: setAuthtoken,
  kill,
  getUrl,
  getApi,
  getVersion,
  getActiveProcess,
  NgrokClientError,
};
