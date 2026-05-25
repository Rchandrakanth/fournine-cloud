const { spawn } = require("child_process");

// MCP stdio server
process.stdin.setEncoding("utf8");

process.stdin.on("data", async (input) => {
  try {
    const msg = JSON.parse(input);

    if (msg.method === "list_pods") {
      const result = await runKubectl(["get", "pods", "-A"]);
      respond(msg.id, result);
    }

    else if (msg.method === "get_nodes") {
      const result = await runKubectl(["get", "nodes"]);
      respond(msg.id, result);
    }

    else if (msg.method === "describe_pod") {
      const pod = msg.params.pod;
      const ns = msg.params.namespace || "default";
      const result = await runKubectl(["describe", "pod", pod, "-n", ns]);
      respond(msg.id, result);
    }

  } catch (err) {
    console.error("Error:", err.message);
  }
});

function runKubectl(args) {
  return new Promise((resolve, reject) => {
    const cmd = spawn("kubectl", args);

    let output = "";
    cmd.stdout.on("data", (data) => (output += data.toString()));
    cmd.stderr.on("data", (data) => (output += data.toString()));

    cmd.on("close", () => resolve(output));
  });
}

function respond(id, result) {
  const response = {
    id,
    result
  };
  process.stdout.write(JSON.stringify(response) + "\n");
}
