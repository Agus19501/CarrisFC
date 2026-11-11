const bcrypt = require("bcryptjs");

function readPassword() {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Ejecuta este comando en una terminal interactiva."));
      return;
    }

    process.stdout.write("Contraseña nueva (no se mostrará): ");
    input.setRawMode(true);
    input.resume();
    let password = "";

    function finish(error) {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    }

    function onData(data) {
      for (const character of data.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Operación cancelada."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else if (character >= " " && character !== "\u007f") {
          password += character;
        }
      }
    }

    input.on("data", onData);
  });
}

async function main() {
  const password = await readPassword();
  if (!password) throw new Error("La contraseña no puede estar vacía.");
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("La contraseña debe ocupar como máximo 72 bytes UTF-8.");
  }
  const hash = await bcrypt.hash(password, 12);
  process.stdout.write(`ADMIN_PASSWORD_HASH=${hash}\n`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
