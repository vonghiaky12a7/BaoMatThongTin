// File này được yêu cầu bởi app.js. Nó thiết lập trình xử lý sự kiện và lắng nghe tin nhắn socket.io.
"use strict";
const { Client } = require("pg");

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
    const query = {
      text: "INSERT INTO users(id, socketid, username, email, password, avatar, status, last_login_date) VALUES($1, $2, $3, $4, $5, $6, $7, $8)",
      values: [
        user.id,
        user.socketid,
        user.username,
        user.email,
        user.password,
        user.avatar,
        user.status,
        new Date(user.lastLoginDate),
      ],
    };

    const result = await client.query(query);
    console.log("User added to database:", result.rows[0]);
  } catch (err) {
    console.error("Error adding user to database:", err);
  }
}

// Sử dụng module gravatar, để chuyển địa chỉ email thành hình ảnh avatar:
var gravatar = require("gravatar");
var manager = require("./manager.js");
var crypto = require("crypto-js");
var serverVersion = manager.generateGuid(); // một phiên bản duy nhất cho mỗi lần khởi động server
var globalChannel = "environment"; // thêm bất kỳ người dùng đã xác thực vào kênh này
var chat = {}; // socket.io
var loginExpireTime = 3600 * 1000; // 3600s

// Xuất một hàm, để chúng ta có thể truyền 
// các instance app và io từ file app.js:
module.exports = function (app, io) {
  // Khởi tạo một ứng dụng socket.io mới, tên là 'chat'
  chat = io;
  io.on("connection", function (socket) {
    console.info(`socket: ${socket.id} connected`);

    // Khi client phát ra 'login', lưu tên và avatar của họ,
    // và thêm họ vào kênhl
    socket.on("login", (data) => {
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

        // var user = {
        //   socketid: socket.id, // just solid for this connection and changed for another connecting times
        //   id: data.email.hashCode(), // unique for this email
        //   username: data.username, // display name, maybe not unique
        //   email: data.email, // unique email address for any users
        //   password: userHashedPass, // Store Password Hashing for client login to authenticate one user per email
        //   avatar: gravatar.url(data.email, { s: "140", r: "x", d: "mm" }), // user avatar picture's
        //   status: "online", // { "online", "offline" }
        //   lastLoginDate: Date.now(), // last login time accourding by server time
        // };

        var newUser = {
          id: data.email.hashCode(),
          socketid: socket.id,
          username: data.username,
          email: data.email,
          password: userHashedPass, // Lưu trữ Mật khẩu Băm để client đăng nhập xác thực một người dùng mỗi email
          avatar: gravatar.url(data.email, { s: "140", r: "x", d: "mm" }),
          status: "online", // { "online", "offline" }
          lastLoginDate: Date.now(), // thời gian đăng nhập cuối cùng theo thời gian máy chủ
        };
        // Thêm người dùng mới vào cơ sở dữ liệu
        addUserToDatabase(newUser);

        // Lưu thông tin người dùng vào manager
        manager.clients[newUser.email.hashCode()] = newUser;

        // manager.clients[user.id] = user;
        // Đăng nhập người dùng mới
        userSigned(newUser, socket);
      }
    }); // login
  }); // connected user - phạm vi socket
}; // module.export func

function userSigned(user, socket) {
  user.status = "online";
  user.socketid = socket.id;
  socket.user = user;
  //
  // send success ack to user by self data object
  socket.emit("signed", {
    id: user.id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    status: user.status,
    serverVersion: serverVersion, // chance of this version caused to refresh clients cached data
  });

  socket.join(globalChannel); // join all users in global authenticated group

  // add user to all joined channels
  var userChannels = manager.getUserChannels(user.id, true); // by p2p channel
  for (var channel in userChannels) {
    socket.join(channel);
  }

  updateAllUsers();
  defineSocketEvents(socket);

  console.info(
    `User <${user.username}> by socket <${user.socketid}> connected`
  );
} // signed-in

function updateAllUsers() {
  // tell new user added and list updated to everyone except the socket that starts it
  chat.sockets.in(globalChannel).emit("update", {
    users: manager.getUsers(),
    channels: manager.getChannels(),
  });
}

function createChannel(name, user, p2p) {
  var channel = {
    name: name,
    p2p: p2p,
    adminUserId: user.id,
    status: "online",
    users: [user.id],
  };
  manager.channels[name] = channel;
  chat.sockets.connected[user.socketid].join(name); // add admin to self chat
  return channel;
}

function defineSocketEvents(socket) {
  // Somebody left the chat
  socket.on("disconnect", () => {
    // Upon disconnection, sockets leave all the channels they were part of automatically,
    // and no special teardown is needed on this part.

    // find user who abandon sockets
    var user = socket.user || manager.findUser(socket.id);
    if (user) {
      console.warn(
        `User <${user.username}> by socket <${user.socketid}> disconnected!`
      );
      user.status = "offline";

      // Notify the other person in the chat channel
      // that his partner has left
      socket.broadcast.to(globalChannel).emit("leave", {
        username: user.username,
        id: user.id,
        avatar: user.avatar,
        status: user.status,
      });
    }
  });

  // Handle the sending of messages
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
      // When the server receives a message, it sends it to the all clients, so also to sender
      chat.sockets.in(channel.name).emit("receive", data);
      msg.push(data);
    }
  });

  // Handle the request of users for chat
  socket.on("request", (data) => {
    // find user who requested to this chat by socket id
    var from = socket.user || manager.findUser(socket.id);

    // if user authenticated
    if (from) {
      data.from = from.id; // inject user id in data

      // find admin user who should be send request to
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
    // from or adminUser is null
    socket.emit("exception", "The requested chat not found!");
  });

  // Handle the request of users for chat
  socket.on("accept", (data) => {
    // find user who accepted to this chat by socket id
    var from = socket.user || manager.findUser(socket.id);

    // find user who is target user by user id
    var to = manager.clients[data.to];

    // if users authenticated
    if (from != null && to != null) {
      var channel = manager.channels[data.channel];

      if (channel == null) {
        // new p2p channel
        channel = createChannel(data.channel, from, true);
      }
      //
      // add new user to this channel
      channel.users.push(to.id);
      chat.sockets.connected[to.socketid].join(channel.name); // add new user to chat channel

      // send accept msg to user which requested to chat
      socket.to(to.socketid).emit("accept", {
        from: from.id,
        channel: channel.name,
        p2p: channel.p2p,
        channelKey: data.channelKey,
      });
    }
  });

  // Handle the request to create channel
  socket.on("createChannel", (name) => {
    var from = socket.user;
    var channel = manager.channels[name];

    if (channel) {
      // the given channel name is already exist!
      socket.emit("reject", {
        from: from.id,
        p2p: false,
        channel: channel,
        msg: "The given channel name is already exist",
      });
      return;
    }

    // create new channel
    channel = createChannel(name, from, false);
    updateAllUsers();

    console.info(
      `Channel <${channel.name}> created by user <${from.username}: ${channel.adminUserId}>`
    );
  });

  // Handle the request of users for chat
  socket.on("reject", (data) => {
    // find user who accepted to this chat by socket id
    var from = socket.user || manager.findUser(socket.id);

    // find user who is target user by user id
    var to = manager.clients[data.to];

    // if users authenticated
    if (from != null && to != null) {
      var channel = manager.channels[data.channel];
      socket.to(to.socketid).emit("reject", {
        from: from.id,
        p2p: channel == null,
        channel: data.channel,
      });
    }
  });

  // Handle the request of users for chat
  socket.on("fetch-messages", (channelName) => {
    // find fetcher user
    var fetcher = socket.user || manager.findUser(socket.id);

    var channel = manager.channels[channelName];

    // check fetcher was a user of channel
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

  socket.on("typing", (channelName) => {
    var user = socket.user || manager.findUser(socket.id);
    var channel = manager.channels[channelName];

    if (user && channel && channel.users.indexOf(user.id) !== -1) {
      chat.sockets
        .in(channel.name)
        .emit("typing", { channel: channel.name, user: user.id });
    }
  });

  // Thêm sự kiện lắng nghe logout
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
