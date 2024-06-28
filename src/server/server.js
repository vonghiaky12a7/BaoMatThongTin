// File này được yêu cầu bởi app.js. Nó thiết lập trình xử lý sự kiện và lắng nghe tin nhắn socket.io.
"use strict";
const { Client } = require("pg");
// Sử dụng module gravatar, để chuyển địa chỉ email thành hình ảnh avatar:
var gravatar = require("gravatar");
var manager = require("./manager.js");
var crypto = require("crypto-js");
var serverVersion = manager.generateGuid(); // một phiên bản duy nhất cho mỗi lần khởi động server
var globalChannel = "environment"; // thêm bất kỳ người dùng đã xác thực vào kênh này
var chat = {}; // socket.io
var loginExpireTime = 3600 * 1000; // 3600s

// Thông tin kết nối đến cơ sở dữ liệu PostgreSQL
const connectionString = "postgresql://postgres:123456@localhost:5432/db_bmtt";

// Tạo một đối tượng kết nối
const client = new Client({
  connectionString: connectionString,
});

// Kết nối tới cơ sở dữ liệu
client
  .connect()
  .then(() => {
    console.log("Connected to PostgreSQL database");
    // Thực hiện truy vấn
    return client.query("SELECT * FROM users");
  })
  .then((result) => {
    console.log("Query result:", result.rows);
  })
  .catch((err) => {
    console.error("Error connecting to PostgreSQL database:", err);
  })
  .finally(() => {
    // Đóng kết nối
  });

// Hàm để thêm một người dùng mới vào cơ sở dữ liệu
async function addUserToDatabase(user) {
  try {
    // Thực hiện truy vấn SELECT để kiểm tra xem người dùng đã tồn tại hay chưa
    const selectQuery = {
      text: "SELECT * FROM users WHERE id = $1",
      values: [user.id],
    };

    const selectResult = await client.query(selectQuery);

    // Nếu người dùng đã tồn tại trong cơ sở dữ liệu
    if (selectResult.rows.length > 0) {
      console.log("User already exists in database:", selectResult.rows[0]);
      document.getElementById("username-error").textContent =
        "Username already exists.";
      return; // Dừng hàm và không thực hiện thêm vào cơ sở dữ liệu
    }

    // Ngược lại, nếu người dùng chưa tồn tại, thực hiện truy vấn INSERT
    const insertQuery = {
      text: "INSERT INTO users(socketid, username, email, password, avatar, status, last_login_date) VALUES($1, $2, $3, $4, $5, $6, $7)",
      values: [
        user.socketid,
        user.username,
        user.email,
        user.password,
        user.avatar,
        user.status,
        new Date(user.lastLoginDate),
      ],
    };

    const insertResult = await client.query(insertQuery);
    console.log("User added to database successfully:", insertResult.rowCount);

    // Thực hiện lại truy vấn SELECT để lấy thông tin chi tiết của người dùng vừa thêm
    const selectInsertedQuery = {
      text: "SELECT * FROM users WHERE id = $1",
      values: [user.id],
    };

    const selectInsertedResult = await client.query(selectInsertedQuery);
    console.log("User details from database:", selectInsertedResult.rows[0]);
  } catch (err) {
    console.error("Error adding user to database:", err);
  }
}

// Xuất một hàm, để chúng ta có thể truyền
// các instance app và io từ file app.js:
module.exports = function (app, io) {
  // Khởi tạo một ứng dụng socket.io mới, tên là 'chat'
  chat = io;
  io.on("connection", function (socket) {
    console.info(`socket: ${socket.id} connected`);
async function addChannelUser(channelName, userId) {
  try {
    await client.query(`SELECT add_channel_user($1, $2)`, [
      channelName,
      userId,
    ]);
    console.log(`User ${userId} added to channel ${channelName}`);

    // Lấy thông tin kênh từ manager
    const channel = manager.channels[channelName];

    // Cập nhật trường p2p nếu kênh không phải là p2p
    if (!channel.p2p) {
      channel.p2p = true;
      // Cập nhật lại thông tin kênh trong cơ sở dữ liệu
      await updateChannelP2P(channelName, true);
      console.log(`Channel ${channelName} updated to p2p`);
    }
  } catch (error) {
    console.error(
      `Error adding user ${userId} to channel ${channelName}:`,
      error
    );
  }
}

// cập nhật p2p cho channel = true
async function updateChannelP2P(channelName, isP2P) {
  try {
    await client.query(`UPDATE public.channels SET p2p = $1 WHERE name = $2`, [
      isP2P,
      channelName,
    ]);
    console.log(`Channel ${channelName} updated to p2p: ${isP2P}`);
  } catch (error) {
    console.error(`Error updating channel ${channelName} to p2p:`, error);
  }
}

// Hàm để xử lý đăng ký người dùng
async function handleRegister(socket, data) {
  try {
    // kiểm tra mật khẩu đăng nhập từ decrypt cipher bằng mật khẩu nonce (socket.id)
    var userHashedPass = crypto.TripleDES.decrypt(
      data.password,
      socket.id
    ).toString(crypto.enc.Utf8);

    // Khi client phát ra 'login', lưu tên và avatar của họ, và thêm họ vào kênhl
    socket.on("login", async (data) => {
      // kiểm tra mật khẩu đăng nhập từ decrypt cipher bằng mật khẩu nonce (socket.id)
      var userHashedPass = crypto.TripleDES.decrypt(
        data.password,
        socket.id
      ).toString(crypto.enc.Utf8);

      var user = manager.clients[data.email.hashCode()];
      if (user) {
        // người dùng tồn tại
        if (user.password == userHashedPass) {
          // kiểm tra hết hạn đăng nhập của người dùng
          if (user.lastLoginDate + loginExpireTime > Date.now()) {
            // hết hạn sau 60 phút
            userSigned(user, socket);
          } else {
            socket.emit("resign");
          }
          user.lastLoginDate = Date.now(); // cập nhật thời gian đăng nhập của người dùng
        } else {
          // người dùng tồn tại, mật khẩu nhập vào không đúng
          socket.emit("exception", "The username or password is incorrect!");
          console.info(
            `User <${user.username}> can't login, because that password is incorrect!`
          );
        }
      } else {
        // người dùng mới
        // Sử dụng đối tượng socket để lưu trữ dữ liệu. Mỗi client nhận được
        // đối tượng socket duy nhất của họ

        var newUser = {
          socketid: socket.id,
          username: data.username,
          email: data.email,
          password: userHashedPass,
          avatar: gravatar.url(data.email, { s: "140", r: "x", d: "mm" }),
          status: "online",
          lastLoginDate: Date.now(),
        };
        var newUserLocal = {
          id: data.email.hashCode(), // Mã hóa email để làm id
          socketid: socket.id,
          username: data.username,
          email: data.email,
          password: userHashedPass,
          avatar: gravatar.url(data.email, { s: "140", r: "x", d: "mm" }),
          status: "online",
          lastLoginDate: Date.now(), // Thời gian đăng nhập lần cuối
        };

        // Thêm người dùng mới vào cơ sở dữ liệu
        addUserToDatabase(newUser);

        // Lưu thông tin người dùng vào manager
        manager.clients[newUserLocal.email.hashCode()] = newUserLocal;

        // Đăng nhập người dùng mới
        userSigned(newUserLocal, socket);
      }
    }); // login
  }); // connected user - phạm vi socket
}; // module.export func


function userRegister(user, socket) {
  user.socketid = socket.id;
  socket.user = user;
  // console.log("socketttttttiddd register:  " + user.socketid);

  socket.join(globalChannel); // Tham gia vào nhóm chung cho tất cả người dùng đã xác thực

  // Thêm người dùng vào tất cả các kênh đã tham gia
  var userChannels = manager.getUserChannels(user.id, true); // Lấy danh sách kênh p2p của người dùng
  for (var channel in userChannels) {
    socket.join(channel);
  }
  updateAllUsers(); // Cập nhật danh sách người dùng cho tất cả
  defineSocketEvents(socket); // Định nghĩa các sự kiện socket

  console.info(
    `User <${user.username}> by socket <${user.socketid}> connected`
  );
} 

function userSigned(user, socket) {
  // Đánh dấu người dùng là "online" và gán socket id cho người dùng
  user.status = "online";
  user.socketid = socket.id;
  socket.user = user;
  //
  // Gửi phản hồi thành công cho người dùng với thông tin đã đăng ký
  socket.emit("signed", {
    id: user.id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    status: user.status,
    serverVersion: serverVersion, // Phiên bản server để làm mới dữ liệu cache của client
  });

  socket.join(globalChannel); // Tham gia vào nhóm chung cho tất cả người dùng đã xác thực

  // Thêm người dùng vào tất cả các kênh đã tham gia
  var userChannels = manager.getUserChannels(user.id, true); // Lấy danh sách kênh p2p của người dùng
  for (var channel in userChannels) {
    socket.join(channel);
  }

  updateAllUsers(); // Cập nhật danh sách người dùng cho tất cả
  defineSocketEvents(socket); // Định nghĩa các sự kiện socket

  console.info(
    `User <${user.username}> by socket <${user.socketid}> connected`
  );
} // signed-in

function updateAllUsers() {
  // Thông báo cho tất cả người dùng khác về sự thêm mới và cập nhật danh sách người dùng và kênh
  chat.sockets.in(globalChannel).emit("update", {
    users: manager.getUsers(),
    channels: manager.getChannels(),
  });
}

function createChannel(name, user, p2p) {
  // Tạo một kênh mới với thông tin nhất định và thêm người dùng làm quản trị viên
  var channel = {
    name: name,
    p2p: p2p,
    adminUserId: user.id,
    status: "online",
    users: [user.id],
  };
  manager.channels[name] = channel; // lưu trữ kênh trong manager

  // Add the admin user to the channel in PostgreSQL
  client
    .query(
      "INSERT INTO channels(name, p2p, adminUserId, status, users) VALUES($1, $2, $3, $4, $5) RETURNING id",
      [name, p2p, user.id, "online", [user.id]]
    )
    .then((res) => {
      const channelId = res.rows[0].id;
      console.log(`Created channel ${channelId}: ${name}`);
    })
    .catch((err) => {
      console.error("Error inserting channel:", err);
    });

  chat.sockets.connected[user.socketid].join(name); // Thêm người dùng làm quản trị viên vào kênh
  return channel;
}

function defineSocketEvents(socket) {
  // Xử lý khi có người dùng ngắt kết nối
  socket.on("disconnect", () => {
    // Khi ngắt kết nối, socket sẽ tự động rời khỏi tất cả các kênh mà nó đã tham gia
    // Không cần thêm bất kỳ thao tác nào đặc biệt ở đây

    // Tìm người dùng đã ngắt kết nối
    var user = socket.user || manager.findUser(socket.id);
    if (user) {
      console.warn(
        `User <${user.username}> by socket <${user.socketid}> disconnected!`
      );
      user.status = "offline";

      // Thông báo cho người dùng khác trong kênh chat rằng đối phương đã rời khỏi
      socket.broadcast.to(globalChannel).emit("leave", {
        username: user.username,
        id: user.id,
        avatar: user.avatar,
        status: user.status,
      });
    }
  });

  // Xử lý khi có tin nhắn được gửi đi
  socket.on("msg", (data) => {
    var from = socket.user || manager.findUser(socket.id);
    var channel = manager.channels[data.to];

    if (
      from != null &&
      channel != null &&
      channel.users.indexOf(from.id) != -1
    ) {
      var msg = manager.messages[channel.name];
      if (msg == null) msg = manager.messages[channel.name] = [];

      data.date = Date.now();
      data.type = "msg";
      // Khi server nhận được tin nhắn, nó sẽ gửi tin nhắn đó đến tất cả các client trong kênh, bao gồm cả người gửi
      chat.sockets.in(channel.name).emit("receive", data);
      msg.push(data);
    }
  });

  // Xử lý khi có yêu cầu chat từ người dùng
  socket.on("request", (data) => {
    // Tìm người dùng gửi yêu cầu chat bằng socket id
    var from = socket.user || manager.findUser(socket.id);

    // Nếu người dùng đã xác thực
    if (from) {
      data.from = from.id; // Thêm id của người dùng vào dữ liệu yêu cầu

      // Tìm người dùng quản trị phù hợp để gửi yêu cầu tới
      var adminUser = manager.getAdminFromChannelName(data.channel, from.id);

      if (adminUser) {
        if (adminUser.status == "offline") {
          var p2p =
            manager.channels[data.channel] == null
              ? true
              : manager.channels[data.channel].p2p;
          socket.emit("reject", {
            from: adminUser.id,
            channel: data.channel,
            p2p: p2p,
            msg: "admin user is offline",
          });
        } else chat.to(adminUser.socketid).emit("request", data);
        return;
      }
    }
    //
    // Nếu from hoặc adminUser là null
    socket.emit("exception", "The requested chat not found!");
  });

  // Xử lý khi có yêu cầu chấp nhận chat từ người dùng
  socket.on("accept", (data) => {
    // Tìm người dùng chấp nhận yêu cầu chat bằng socket id
  socket.on("accept", async (data) => {
    var from = socket.user || manager.findUser(socket.id);

    // Tìm người dùng mục tiêu để chấp nhận chat bằng user id
    var to = manager.clients[data.to];

    // Nếu cả hai người dùng đã xác thực
    if (from != null && to != null) {
      var channel = manager.channels[data.channel];

      if (channel == null) {
        // Tạo kênh p2p mới
        channel = createChannel(data.channel, from, true);
      }
      //
      // Thêm người dùng mới vào kênh này
      channel.users.push(to.id);
      chat.sockets.connected[to.socketid].join(channel.name); // Thêm người dùng mới vào kênh chat
      if (!channel.users.includes(to.id)) {
        channel.users.push(to.id);

        // Cập nhật cơ sở dữ liệu với người dùng mới được thêm vào kênh
        await addChannelUser(channel.name, to.id);
      }

      chat.sockets.connected[to.socketid].join(channel.name);

      // Gửi tin nhắn chấp nhận cho người dùng đã gửi yêu cầu chat
      socket.to(to.socketid).emit("accept", {
        from: from.id,
        channel: channel.name,
        p2p: channel.p2p,
        channelKey: data.channelKey,
      });
    }
  });

  // Xử lý khi có yêu cầu tạo kênh mới
  socket.on("createChannel", (name) => {
    var from = socket.user;
    var channel = manager.channels[name];

    if (channel) {
      // Tên kênh đã tồn tại
      socket.emit("reject", {
        from: from.id,
        p2p: false,
        channel: channel,
        msg: "The given channel name is already exist",
      });
      return;
    }

    // Tạo kênh mới
    channel = createChannel(name, from, false);
    updateAllUsers();

    console.info(
      `Channel <${channel.name}> created by user <${from.username}: ${channel.adminUserId}>`
    );
  });

  // Xử lý khi có yêu cầu từ chối chat
  socket.on("reject", (data) => {
    // Tìm người dùng từ chối chat bằng socket id
    var from = socket.user || manager.findUser(socket.id);

    // Tìm người dùng mục tiêu để từ chối chat bằng user id
    var to = manager.clients[data.to];

    // Nếu cả hai người dùng đã xác thực
    if (from != null && to != null) {
      var channel = manager.channels[data.channel];
      socket.to(to.socketid).emit("reject", {
        from: from.id,
        p2p: channel == null,
        channel: data.channel,
      });
    }
  });

  // Xử lý khi có yêu cầu fetch-messages từ người dùng
  socket.on("fetch-messages", (channelName) => {
    // find fetcher user
    var fetcher = socket.user || manager.findUser(socket.id);

    var channel = manager.channels[channelName];

    // Kiểm tra fetcher đã là thành viên của kênh chưa
    if (
      fetcher != null &&
      channel != null &&
      channel.users.indexOf(fetcher.id) !== -1
    )
      socket.emit("fetch-messages", {
        channel: channel.name,
        messages: manager.messages[channel.name],
      });
    else
      socket.emit(
        "exception",
        `you are not joined in <${channelName}> channel or maybe the server was lost your data!!!`
      );
  });
  // Xử lý khi có yêu cầu typing từ người dùng
  socket.on("typing", (channelName) => {
    var user = socket.user || manager.findUser(socket.id);
    var channel = manager.channels[channelName];

    if (user && channel && channel.users.indexOf(user.id) !== -1) {
      chat.sockets
        .in(channel.name)
        .emit("typing", { channel: channel.name, user: user.id });
    }
  });

  // Xử lý khi có yêu cầu logout từ người dùng
  socket.on("logout", (data) => {
    var user = manager.clients[data.userId];
    if (user) {
      user.status = "offline";
      console.info(`User <${user.username}> has logged out`);
      updateAllUsers();
    }
    // Ngắt kết nối socket của người dùng
    socket.disconnect(true);
  });
} // defineSocketEvents
