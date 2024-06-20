// Đây là file chính của ứng dụng chat. Nó khởi tạo một instance mới của
// express.js, yêu cầu các file config và routes, và lắng nghe trên một cổng.
var express = require('express');
var path = require("path");
var app = express();
var port = 80;

// Khởi tạo một đối tượng socket.io mới. Nó được gắn kết với 
// ứng dụng express, cho phép chúng cùng tồn tại.
var io = require("socket.io").listen(app.listen(port));

// ---Cấu hình thư mục và file tĩnh---
// Đặt .html làm phần mở rộng template mặc định
app.set("view engine", "html");

// Khởi tạo engine template ejs
app.engine("html", require("ejs").renderFile);

// Chỉ định cho express nơi tìm kiếm các template
app.set("views", path.join(__dirname, "client/views"));

// Làm cho các file trong thư mục public có sẵn
app.use(express.static(path.join(__dirname, "client")));


// Cấu hình Router
// thiết lập các listener sự kiện cho hai endpoint URL chính của ứng dụng - /
app.get("/", function (req, res) {
  // Render views/chat.html
  res.render("chat");
});
// =======================================================================

// Yêu cầu file cấu hình và các file routes, và truyền
// app và io làm đối số cho các hàm trả về.
require("./server/server")(app, io);

console.log("Your application is running on http://localhost:" + port);
