/**
 * @returns {import('@forge/api').WebTriggerResponse}
 */
const buildOutput = (rnd) => ({
  body: '{"hello": "world"}',
  headers: {
    "Content-Type": ["application/json"],
    "X-Request-Id": [`rnd-${rnd}`],
  },
  statusCode: 200,
  statusText: "OK",
});

/**
 * @param {import('@forge/api').WebTriggerRequest} event
 * @param {import('@forge/api').WebTriggerContext} context
 * @returns {Promise<import('@forge/api').WebTriggerResponse>}
 */
exports.runAsync = (event, context) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = buildOutput(Math.random());
      resolve(result);
    }, 1000);
  });
};

/**
 * @param {import('@forge/api').WebTriggerRequest} event
 * @param {import('@forge/api').WebTriggerContext} context
 * @returns {import('@forge/api').WebTriggerResponse}
 */
exports.runSync = (event, context) => {
  const result = buildOutput(Math.random());
  return result;
};
