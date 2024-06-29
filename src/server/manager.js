var e = {};
module.exports = e;

e.clients = {}; // thuộc tính: id, giá trị: { socketid, id, username, email, pubKey, password, avatar, status }
e.messageTypes = ["ack", "request", "message", "symmetricKey"];
e.messages = {}; // thuộc tính: channelName, giá trị: { from, to, date, type }
e.channels = {}; // thuộc tính: channelName, giá trị: { name, p2p, adminUserId, users[] }

// tạo GUID dài 16 ký tự
e.generateGuid = function () {
  return (
    Math.random().toString(36).substring(2, 10) +
    Math.random().toString(36).substring(2, 10)
  );
};

// hàm băm chuỗi
e.getHashCode = String.prototype.hashCode = function () {
  var hash = 0,
    i,
    chr;
  if (this.length == 0) return hash;
  for (i = 0; i < this.length; i++) {
    chr = this.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Chuyển đổi thành số nguyên 32 bit
  }
  return hash.toString(32); // chuyển đổi sang cơ số 32
};

// hàm lấy thông tin người dùng
e.getUsers = function () {
  var users = {};
  for (prop in e.clients) {
    var u = e.clients[prop];
    users[prop] = {
      id: u.id,
      email: u.email,
      username: u.username,
      avatar: u.avatar,
      status: u.status,
    };
  }
  return users;
};

// hàm lấy các kênh của người dùng
e.getUserChannels = function (userId, byP2p = false) {
  var userChannels = {};
  if (userId) {
    for (prop in e.channels) {
      var r = e.channels[prop];
      if (r.users.indexOf(userId) !== -1) {
        if ((byP2p === false && r.p2p === false) || byP2p === true)
          userChannels[prop] = r;
      }
    }
  }
  return userChannels;
};

// hàm lấy tất cả các kênh
e.getChannels = function () {
  var lstChannels = {};
  for (prop in e.channels) {
    var r = e.channels[prop];
    if (r.p2p === false) {
      lstChannels[prop] = r;  
    }
  }
  return lstChannels;
};

// hàm tìm người dùng theo socketid
e.findUser = function (socketid) {
  for (prop in e.clients) {
    var u = e.clients[prop];
    if (u.socketid === socketid) {
      return u;
    }
  }
  return null; // không tìm thấy người dùng
};

// hàm tạo tên kênh
e.generateChannelName = function (uid0, uid1) {
  var ids = [uid0, uid1].sort();
  return ids[0] + "_" + ids[1]; // tên duy nhất cho kênh riêng tư của người dùng
};

// hàm lấy admin từ tên kênh
e.getAdminFromChannelName = function (channelName, userid) {
  var admin = null;

  // tìm kênh để gửi yêu cầu của client
  var channel = e.channels[channelName];

  if (channel == null) {
    // yêu cầu tạo kênh p2p mới
    var halfIndex = channelName.indexOf("_");
    if (halfIndex < 1) return null; // tên kênh p2p không đúng

    var u0 = channelName.substring(0, halfIndex);
    var u1 = channelName.substring(halfIndex + 1);

    admin =
      u0 === userid
        ? e.clients[u1] // u1 là admin
        : (admin = e.clients[u0]); // u0 là admin
  } else admin = e.clients[channel.adminUserId];

  return admin;
};
