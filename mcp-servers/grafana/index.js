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
          name: "grafana",
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
            name: "list_dashboards",
            description: "List dashboards from Grafana",
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

    if (name === "list_dashboards") {
      try {
        const data = await listDashboards();
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

  // Legacy/direct custom method (just in case)
  if (method === "list_dashboards") {
    try {
      const data = await listDashboards();
      sendResponse({
        id: id,
        result: data
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

async function getGrafanaUrl() {
  try {
    const nodePortStr = await runKubectl([
      "get",
      "svc",
      "grafana-service",
      "-o",
      "jsonpath={.spec.ports[?(@.port==3000)].nodePort}"
    ]);
    const nodePort = parseInt(nodePortStr, 10) || 30014;
    const nodeIp = await runKubectl([
      "get",
      "nodes",
      "-o",
      "jsonpath={.items[0].status.addresses[?(@.type==\"InternalIP\")].address}"
    ]);
    return {
      host: nodeIp || "172.18.0.2",
      port: nodePort
    };
  } catch (err) {
    return {
      host: "172.18.0.2",
      port: 30014
    };
  }
}

function httpGet(options) {
  return new Promise((resolve, reject) => {
    http.get(options, (res) => {
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

async function listDashboards() {
  const connection = await getGrafanaUrl();
  const options = {
    hostname: connection.host,
    port: connection.port,
    path: "/api/search",
    method: "GET",
    auth: "admin:admin@123"
  };
  return await httpGet(options);
}
