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
    return client.query("SELECT * FROM users");
  })
  .then((result) => {
    console.log("Query result:", result.rows);
  })
  .catch((err) => {
    console.error("Error connecting to PostgreSQL database:", err);
  });

async function getAllUsersFromDatabase() {
  try {
    // Truy vấn để lấy tất cả thông tin người dùng
    const query = {
      text: "SELECT * FROM users",
    };

    // Thực hiện truy vấn
    const result = await client.query(query);

    // Trả về danh sách tất cả người dùng
    return result.rows;
  } catch (error) {
    console.error("Error retrieving users from database:", error);
    throw error; // Xử lý lỗi nếu có
  }
}
async function addUserToDatabase(user) {
  try {
    // Thực hiện truy vấn SELECT
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
      return;
    }
    // Ngược lại, nếuchưa tồn tại thì INSERT
    const insertQuery = {
      text: "INSERT INTO users(id,socketid, username, email, password, avatar, status, last_login_date, second) VALUES($1, $2, $3, $4, $5, $6, $7,$8, $9)",
      values: [
        user.id,
        user.socketid,
        user.username,
        user.email,
        user.password,
        user.avatar,
        user.status,
        new Date(user.lastLoginDate),
        user.second,
      ],
    };

    await client.query(insertQuery);
    console.log("User added to database successfully:");

    // Thực hiện lại truy vấn SELECT để lấy thông tin chi tiết của người dùng vừa thêm
    const selectInsertedQuery = {
      text: "SELECT * FROM users WHERE id = $1",
      values: [user.id],
    };
    const selectInsertedResult = await client.query(selectInsertedQuery);
    console.log("User details from database:", selectInsertedResult.rows[0]);
  } catch (err) {
    console.error("Error adding user to database:", err);
    throw err;
  }
}
async function GetUserFromDatabase(email) {
  try {
    // Truy vấn để lấy thông tin người dùng từ email
    const query = {
      text: "SELECT * FROM users WHERE email = $1",
      values: [email],
    };

    // Thực hiện truy vấn
    const result = await client.query(query);

    // Nếu không tìm thấy người dùng
    if (result.rows.length === 0) {
      return null; // Trả về null nếu không có người dùng
    }

    // Lấy thông tin người dùng từ kết quả truy vấn
    const user = result.rows[0];

    return user; // Trả về thông tin người dùng
  } catch (error) {
    console.error("Error retrieving user from database:", error);
    throw error; // Xử lý lỗi nếu có
  }
}
async function updateUserInDatabase(user) {
  try {
    // Truy vấn để cập nhật thông tin người dùng
    const query = {
      text: "UPDATE users SET socketid = $1, status = $2, last_login_date = $3, second = $4 WHERE email = $5",
      values: [
        user.socketid,
        user.status,
        new Date(user.lastLoginDate),
        user.second,
        user.email,
      ],
    };

    // Thực hiện truy vấn
    await client.query(query);
  } catch (error) {
    console.error("Error updating user in database:", error);
    throw error; // Xử lý lỗi nếu có
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

    console.log("Register");
    console.log("Server password received: " + data.password);
    console.log("Decrypt password using 3 DES: " + userHashedPass);

    // Lấy thông tin người dùng từ cơ sở dữ liệu
    var user = await GetUserFromDatabase(data.email);

    if (user) {
      // người dùng tồn tại
      socket.emit("registerExits", "User already exists!"); // Xử lý trường hợp người dùng đã tồn tại
    } else {
      // Người dùng chưa tồn tại, tiến hành đăng ký
      var newUser = {
        id: data.email.hashCode(), // Mã hóa email để làm id
        socketid: socket.id,
        username: data.username,
        email: data.email,
        password: userHashedPass,
        avatar: gravatar.url(data.email, { s: "140", r: "x", d: "mm" }),
        status: "offline",
        lastLoginDate: Date.now(),
        second: Date.now(),
      };

      // Thêm người dùng mới vào cơ sở dữ liệu
      await addUserToDatabase(newUser);

      // Lưu thông tin người dùng vào manager
      manager.clients[newUser.email.hashCode()] = newUser;
      // Gọi userSigned để đánh dấu người dùng là "online"
      userRegister(newUser, socket);
      socket.emit("registerSuccess", "Registration successful! Please log in.");
    }
  } catch (error) {
    console.error("Error during registration:", error);
    socket.emit("exception", "Error during registration");
  }
}

// Hàm để xử lý đăng nhập người dùng
async function handleLogin(socket, data) {
  try {
    // kiểm tra mật khẩu đăng nhập từ decrypt cipher bằng mật khẩu nonce (socket.id)
    var userHashedPass = crypto.TripleDES.decrypt(
      data.password,
      socket.id
    ).toString(crypto.enc.Utf8);
    // Lấy thông tin người dùng từ cơ sở dữ liệu
    console.log("Login");
    console.log("Server password received: " + data.password);
    console.log("Decrypt password using 3 DES: " + userHashedPass);
    var user = await GetUserFromDatabase(data.email);
    if (user) {
      if (user.password === userHashedPass) {
        // kiểm tra hết hạn đăng nhập của người dùng
        if (user.second + loginExpireTime > Date.now()) {
          userSigned(user, socket);
        } else {
          console.log("Re-login");
          socket.emit("resign");
        }
        // Cập nhật thời gian đăng nhập của người dùng và socketid
        user.lastLoginDate = Date.now();
        user.second = Date.now();
        user.socketid = socket.id;
        user.status = "online";

        // Cập nhật thông tin người dùng vào cơ sở dữ liệu
        await updateUserInDatabase(user);

        // Cập nhật thông tin người dùng vào manager.clients
        const updateUser = {
          id: data.email.hashCode(), // Mã hóa email để làm id
          socketid: socket.id,
          username: data.username,
          email: data.email,
          password: userHashedPass,
          avatar: gravatar.url(data.email, { s: "140", r: "x", d: "mm" }),
          status: "online",
          lastLoginDate: Date.now(),
          second: Date.now(),
        };
        manager.clients[updateUser.email.hashCode()] = updateUser;
      } else {
        socket.emit("exception", "The username or password is incorrect!");
        console.info(
          `User <${user.username}> can't login, because that password is incorrect!`
        );
      }
    } else {
      // Người dùng không tồn tại
      socket.emit("loginFailed", "User not found, please register.");
      console.info(`User with email <${data.email}> not found!`);
    }
  } catch (error) {
    console.error("Error during login:", error);
    socket.emit("exception", "Error during login");
  }
}

module.exports = function (app, io) {
  chat = io;
  // Hàm khởi tạo để lấy tất cả người dùng và lưu vào manager.clients
  async function initializeUsers() {
    try {
      const users = await getAllUsersFromDatabase();
      users.forEach((user) => {
        manager.clients[user.email.hashCode()] = user;
      });
      console.info("All users have been loaded into manager.clients");
    } catch (error) {
      console.error("Error initializing users:", error);
    }
  }

  // Gọi hàm khởi tạo khi ứng dụng khởi động
  initializeUsers();
  io.on("connection", function (socket) {
    console.info(`socket: ${socket.id} connected`);

    // Xử lý khi client gửi sự kiện 'login'
    socket.on("login", async (data) => {
      await handleLogin(socket, data);
    });

    // Xử lý khi client gửi sự kiện 'register'
    socket.on("register", async (data) => {
      await handleRegister(socket, data);
    });
  });
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
} // signed-in
function userSigned(user, socket) {
  // Đánh dấu người dùng là "online" và gán socket id cho người dùng
  user.status = "online";
  user.socketid = socket.id;
  socket.user = user;
  // Gửi phản hồi thành công cho người dùng với thông tin đã đăng ký
  socket.emit("signed", {
    id: user.id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    status: user.status,
    socketid: user.socketid,
    serverVersion: serverVersion, // Phiên bản server để làm mới dữ liệu cache của client
  });

  socket.join(globalChannel); // Tham gia vào nhóm chung cho tất cả người dùng đã xác thực

  // Thêm người dùng vào tất cả các kênh đã tham gia
  var userChannels = manager.getUserChannels(user.id, true); // Lấy danh sách kênh p2p của người dùng
  for (var channel in userChannels) {
    socket.join(channel);
  }
  console.log("Đã thêm vào kênh: ");
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
  manager.channels[name] = channel;
  chat.sockets.connected[user.socketid].join(name); // Thêm người dùng làm quản trị viên vào kênh
  return channel;
}

// chỉ xóa tin của tôi
function deleteMessagesFromUser(userId, channelName) {
  if (manager.messages[channelName]) {
    manager.messages[channelName] = manager.messages[channelName].filter(
      (msg) => msg.from !== userId
    );
  }
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

    if (from && channel && channel.users.includes(from.id)) {
      var msg = manager.messages[channel.name] || [];
      data.date = Date.now();
      data.type = "msg";
      chat.sockets.in(channel.name).emit("receive", data);
      msg.push(data);
      manager.messages[channel.name] = msg;
    }
  });

  socket.on("request", (data) => {
    var from = socket.user || manager.findUser(socket.id);

    if (from) {
      data.from = from.id;
      var adminUser = manager.getAdminFromChannelName(data.channel, from.id);

      if (adminUser) {
        if (adminUser.status === "offline") {
          var p2p = !manager.channels[data.channel];
          socket.emit("reject", {
            from: adminUser.id,
            channel: data.channel,
            p2p: p2p,
            msg: "admin user is offline",
          });
        } else {
          chat.to(adminUser.socketid).emit("request", data);
        }
        return;
      }
    }
    socket.emit("exception", "The requested chat not found!");
  });

  // Xử lý khi có yêu cầu chấp nhận chat từ người dùng
  socket.on("accept", (data) => {
    var from = socket.user || manager.findUser(socket.id);
    var to = manager.clients[data.to];

    if (from && to) {
      var channel =
        manager.channels[data.channel] ||
        createChannel(data.channel, from, true);

      if (!channel.users.includes(to.id)) {
        channel.users.push(to.id);
      }
      chat.sockets.connected[to.socketid].join(channel.name);

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
  // Xử lý khi có yêu cầu logout từ người dùng
  socket.on("logout", (data) => {
    var user = manager.clients[data.userId];

    if (user) {
      // Xóa tin nhắn của người dùng khỏi tất cả các kênh mà người dùng tham gia
      for (var channelName in manager.channels) {
        if (manager.channels[channelName].users.includes(user.id)) {
          deleteMessagesFromUser(user.id, channelName);
          // Thông báo cho tất cả các client trong kênh đó
          chat.sockets.in(channelName).emit("updateMessages", {
            channelName: channelName,
            messages: manager.messages[channelName],
          });
        }
      }
      user.status = "offline";
      console.info(`User <${user.username}> has logged out`);
      updateAllUsers();
    }
    // Ngắt kết nối socket của người dùng
    socket.disconnect(true);
  });
} // defineSocketEvents
