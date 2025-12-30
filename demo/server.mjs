import http from "http";
import fs from "fs";
import path from "path";

const PUBLIC_DIR = path.join(process.cwd(), "public");

const mime = (file) => {
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "application/javascript";
  return "text/html";
};

const serve = (res, status, body, type) => {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let filePath = "login.html";

  if (url.pathname === "/items") filePath = "items.html";
  else if (url.pathname === "/login") filePath = "login.html";
  else if (url.pathname === "/style.css") filePath = "style.css";

  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fs.existsSync(fullPath)) {
    serve(res, 404, "Not found", "text/plain");
    return;
  }

  const body = fs.readFileSync(fullPath);
  serve(res, 200, body, mime(fullPath));
}).listen(3000, () => {
  console.log("Demo server listening on 3000");
});
