const http = require("http");
const { spawn } = require("child_process");

process.stdin.setEncoding("utf8");

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let lineEnd;
  while ((lineEnd = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (line) {
      handleMessage(line).catch((err) => {
        console.error("Error handling message:", err);
      });
    }
  }
});

async function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    console.error("Failed to parse JSON:", err);
    return;
  }

  const { method, id, params } = msg;

  // Handle standard MCP lifecycle
  if (method === "initialize") {
    sendResponse({
      jsonrpc: "2.0",
      id: id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "prometheus",
          version: "1.0.0"
        }
      }
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  // Handle standard MCP tools list
  if (method === "tools/list") {
    sendResponse({
      jsonrpc: "2.0",
      id: id,
      result: {
        tools: [
          {
            name: "query_prometheus",
            description: "Run a PromQL query against Prometheus",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The PromQL query to run (e.g. 'up' or 'node_memory_MemTotal_bytes')"
                }
              },
              required: ["query"]
            }
          },
          {
            name: "get_targets",
            description: "Get the health and status of Prometheus discovery targets",
            inputSchema: {
              type: "object",
              properties: {}
            }
          }
        ]
      }
    });
    return;
  }

  // Handle standard MCP tools call
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};

    if (name === "query_prometheus") {
      try {
        const data = await queryPrometheus(args.query);
        sendResponse({
          jsonrpc: "2.0",
          id: id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(data, null, 2)
              }
            ]
          }
        });
      } catch (err) {
        sendError(id, err.message);
      }
      return;
    }

    if (name === "get_targets") {
      try {
        const data = await getTargets();
        sendResponse({
          jsonrpc: "2.0",
          id: id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(data, null, 2)
              }
            ]
          }
        });
      } catch (err) {
        sendError(id, err.message);
      }
      return;
    }

    sendError(id, `Unknown tool: ${name}`);
    return;
  }

  // Legacy/direct custom methods (just in case)
  if (method === "query_prometheus") {
    try {
      const data = await queryPrometheus(params?.query);
      sendResponse({
        id: id,
        result: JSON.stringify(data)
      });
    } catch (err) {
      sendResponse({
        id: id,
        error: err.message
      });
    }
    return;
  }

  if (method === "get_targets") {
    try {
      const data = await getTargets();
      sendResponse({
        id: id,
        result: JSON.stringify(data)
      });
    } catch (err) {
      sendResponse({
        id: id,
        error: err.message
      });
    }
    return;
  }
}

function sendResponse(response) {
  process.stdout.write(JSON.stringify(response) + "\n");
}

function sendError(id, message) {
  sendResponse({
    jsonrpc: "2.0",
    id: id,
    error: {
      code: -32603,
      message: message
    }
  });
}

function runKubectl(args) {
  return new Promise((resolve, reject) => {
    const cmd = spawn("kubectl", args);
    let output = "";
    cmd.stdout.on("data", (data) => (output += data.toString()));
    cmd.stderr.on("data", (data) => (output += data.toString()));
    cmd.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(output.trim()));
    });
  });
}

async function getPrometheusUrl() {
  try {
    const nodePortStr = await runKubectl([
      "get",
      "svc",
      "prometheus-service",
      "-o",
      "jsonpath={.spec.ports[?(@.port==9090)].nodePort}"
    ]);
    const nodePort = parseInt(nodePortStr, 10) || 30010;
    const nodeIp = await runKubectl([
      "get",
      "nodes",
      "-o",
      "jsonpath={.items[0].status.addresses[?(@.type==\"InternalIP\")].address}"
    ]);
    return `http://${nodeIp || "172.18.0.2"}:${nodePort}`;
  } catch (err) {
    return "http://172.18.0.2:30010";
  }
}

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    http.get(urlStr, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on("error", (err) => {
      reject(err);
    });
  });
}

async function queryPrometheus(query) {
  const baseUrl = await getPrometheusUrl();
  const url = `${baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
  return await httpGet(url);
}

async function getTargets() {
  const baseUrl = await getPrometheusUrl();
  const url = `${baseUrl}/api/v1/targets`;
  return await httpGet(url);
}
