import {
  randomBytes,
  scryptSync,
} from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const username = (process.argv[2] ?? "researcher").trim();
if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
  throw new Error(
    "The admin username must contain 3-64 ASCII letters, numbers, dots, underscores, or hyphens.",
  );
}

const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16);
const passwordHash = scryptSync(password, salt, 32);
const sessionSecret = randomBytes(48).toString("base64url");
const randomizationHmacSecret = randomBytes(48).toString("base64url");
const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output=")
);
const outputPath = outputArgument
  ? path.resolve(outputArgument.slice("--output=".length))
  : null;
const credentialOutputArgument = process.argv.find((argument) =>
  argument.startsWith("--credential-output=")
);
const credentialOutputPath = credentialOutputArgument
  ? path.resolve(
      credentialOutputArgument.slice("--credential-output=".length),
    )
  : null;

const config = [
  "Store this login password securely. Do NOT add the login password itself to Netlify:",
  `Login password: ${password}`,
  "",
  "Add only these four values to the matching Netlify deploy context:",
  `MMQ_ADMIN_USERNAME=${username}`,
  "MMQ_ADMIN_PASSWORD_HASH="
    + `scrypt.${salt.toString("base64url")}`
    + `.${passwordHash.toString("base64url")}`,
  `MMQ_ADMIN_SESSION_SECRET=${sessionSecret}`,
  `MMQ_RANDOMIZATION_HMAC_SECRET=${randomizationHmacSecret}`,
].join("\n");

if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${config}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    `Generated admin configuration for '${username}' at ${outputPath}`,
  );
} else {
  console.log(config);
}

if (credentialOutputPath) {
  await mkdir(path.dirname(credentialOutputPath), { recursive: true });
  await writeFile(
    credentialOutputPath,
    [
      "研究人员后台：https://sequence-prediction-study.netlify.app/admin.html",
      `用户名：${username}`,
      `登录密码：${password}`,
      "",
      "此文件仅供研究团队保管，不得上传至 GitHub 或发送给参与者。",
    ].join("\n"),
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
  console.log(
    `Generated a researcher login note at ${credentialOutputPath}`,
  );
}
