/* Tệp này được thực thi trong trình duyệt, khi người dùng truy cập / */
"use strict";

// các biến chứa dữ liệu cho mỗi người
var socket = io(), // kết nối tới socket
  lstUsers = {},
  lstChannels = null,
  currentChannelName = "",
  channelMessages = {},
  channels = null,
  state = ["offline", "online"],
  lstTypingUser = {},
  keys = getCipherKeys();

// khi kết nối tới server, lấy id của kênh người dùng
socket.on("connect", () => {
  console.log(`connected by socket.id: ${socket.id}`);
  setConnectionStatus("connected");
  var me = getMe();
  if (me && localStorage.hashedPass) {
    // nonce password
    me.password = getNoncePassword(localStorage.hashedPass);
    socket.emit("login", me);
  }
});
// Xử lý khi đăng nhập thất bại
socket.on("loginFailed", (message) => {
  console.log(message); // Hiển thị thông báo lỗi nếu có
  var me = getMe();
  if (me && localStorage.hashedPass) {
    // nonce password
    me.password = getNoncePassword(localStorage.hashedPass);
    socket.emit("register", me);
  }
});
socket.on("registerSuccess", (message) => {
  alert(message); // Hiển thị thông báo đăng ký thành công
  // Chuyển người dùng sang trang đăng nhập hoặc hiển thị form đăng <n></n>hập
  $("#registerForm").hide();
  $("#loginForm").show();
});

// khi phiên đăng nhập của tôi hết hạn từ thời gian máy chủ
socket.on("resign", () => {
  console.log("Re-login");
  var me = getMe();
  $(".login100-form-title").html("Login");
  $("#loginEmail").val(me.email);
  $("#loginAvatar").attr("src", me.avatar);
});

// khi tôi bị ngắt kết nối từ server, đổi trạng thái của tôi thành offline
socket.on("disconnect", () => {
  console.warn(`socket <${getMe().socketid}> disconnected!`);
  setConnectionStatus("disconnected");
});

// khi có lỗi khi đến server
socket.on("userExits", (err) => {
  alert(err);
});
socket.on("exception", (err) => {
  alert(err);
});

// lưu dữ liệu người dùng của tôi khi tôi đăng nhập thành công tới server
socket.on("signed", (me) => {
  console.log("Dữ liệu nhận được từ server:", me); // Log dữ liệu để kiểm tra
  signedin(me);
});

// cập nhật dữ liệu người dùng và kênh khi trạng thái của họ thay đổi
socket.on("update", (data) => {
  lstUsers = data.users;
  lstChannels = data.channels;
  $("#userContacts").empty();
  $("#channelContacts").empty();

  delete lstUsers[getMe().id]; // loại bỏ bản than khỏi danh sách người dùng
  for (var prop in lstUsers) {
    var user = lstUsers[prop];
    var channel = getChannelName(user.id);
    $("#userContacts").append(
      "<li id='" +
        channel +
        "' class='contact'>" +
        getUserLink(user, channel) +
        "</li>"
    );
  }

  for (var prop in lstChannels) {
    var channel = lstChannels[prop];
    $("#channelContacts").append(
      "<li id='" +
        channel.name +
        "' class='contact'>" +
        getChannelLink(channel) +
        "</li>"
    );
  }

  if (currentChannelName != null && currentChannelName.length > 0) {
    chatStarted(currentChannelName);
  }
});

// khi một client socket ngắt kết nối hoặc một admin kênh offline
socket.on("leave", (leftedUser) => {
  var u = lstUsers[leftedUser.id];
  if (u != null) {
    u.status = leftedUser.status;
    var chat = getChannelName(u.id);
    $(`#${chat}`).html(getUserLink(u, chat));
  }
});

socket.on("request", (data) => {
  var reqUser = lstUsers[data.from];
  if (reqUser == null) {
    socket.emit("reject", {
      to: data.from,
      channel: data.channel,
      msg: "I don't know who requested!",
    });
    return;
  }

  var reqChannel = getChannels()[data.channel];

  if (reqChannel == null) {
    // không tồn tại trong danh sách kênh
    // hỏi tôi chấp nhận hay từ chối yêu cầu người dùng
    if (
      confirm(`Do you allow <${reqUser.username}> to chat with you?`) == false
    ) {
      socket.emit("reject", { to: data.from, channel: data.channel });
      return;
    }
    createChannel(data.channel, true);
    reqChannel = getChannels()[data.channel];
  } else if (reqChannel.p2p === false) {
    // hỏi tôi chấp nhận hay từ chối yêu cầu người dùng
    if (
      confirm(
        `Do you allow <${reqUser.username}> to join in <${reqChannel.name}> channel?`
      ) == false
    ) {
      socket.emit("reject", { to: data.from, channel: data.channel });
      return;
    }
  }
  // mã hóa khóa chat symmetricKey bằng khóa công khai của người dùng yêu cầu
  var encryptedChannelKey = reqChannel.channelKey.asymEncrypt(data.pubKey);
  // gửi dữ liệu đến người dùng yêu cầu để tham gia vào kênh hiện tại
  console.log(
    "Encrypts the chat key symmetricKey with the requesting user's public key:"
  );
  console.log("Public key: " + data.pubKey);
  console.log("Encrypted Channel Key: " + encryptedChannelKey);

  socket.emit("accept", {
    to: data.from,
    channelKey: encryptedChannelKey,
    channel: reqChannel.name,
  });
  chatStarted(reqChannel.name);
});

// khi yêu cầu chat của tôi được chấp nhận bởi admin kênh
socket.on("accept", (data) => {
  // giải mã mật mã RSA bằng khóa riêng của tôi
  var symmetricKey = data.channelKey.asymDecrypt(keys.privateKey);
  console.log(
    "My chat request was accepted by the channel admin, decrypting the RSA with my private key:\n"
  );
  console.log("Private key: " + keys.privateKey);
  console.log("Decrypted Channel Key: " + symmetricKey);
  // lưu trữ kênh này vào danh sách kênh của tôi
  setChannel(data.channel, {
    name: data.channel,
    p2p: data.p2p,
    channelKey: symmetricKey,
  });
  chatStarted(data.channel);
});

// khi yêu cầu chat của tôi bị từ chối bởi admin kênh
socket.on("reject", (data) => {
  var admin = lstUsers[data.from];
  var reason = data.msg ? `because ${data.msg}` : "";
  if (data.p2p)
    alert(`Your chat request to <${admin.username}> rejected. ${reason}`);
  else
    alert(`Your join request to <${data.channel}> channel rejected ${reason}`);

  $(`#${data.channel}`).find(".wait").css("display", "none");
});

// khi một tin nhắn được gửi tới tôi hoặc kênh mà tôi là thành viên
socket.on("receive", (data) => {
  if (currentChannelName == data.to)
    // từ cuộc trò chuyện hiện tại
    appendMessage(data);
  else {
    // lưu trữ trong bộ đệm để xem sau
    data.state = "replies";
    //
    // tăng badge
    var badge = $(`#${data.to}`).find(".badge");
    var badgeVal = badge.attr("data-badge");
    if (badgeVal == "") badgeVal = 0;
    // badge.attr("data-badge", parseInt(badgeVal) + 1);
    badge.attr("data-badge", (badgeVal ? parseInt(badgeVal) : 0) + 1);
  }

  getMessages(data.to).push(data);
});

// khi nhận được phản hồi từ yêu cầu của tôi để lấy lịch sử các tin nhắn chat
socket.on("fetch-messages", (data) => {
  if (data.messages == null) data.messages == []; // đặt thành không-null để yêu cầu lần sau
  channelMessages[data.channel] = data.messages;
  updateMessages();
});

socket.on("error", () => {
  console.log("Client: error");
  socket.socket.reconnect();
});

// khi một người dùng đang gõ trong một cuộc trò chuyện liên quan tới tôi
socket.on("typing", (data) => {
  var user = lstUsers[data.user];
  var channel = getChannels()[data.channel];
  if (channel && user && channel.name === currentChannelName) {
    lstTypingUser[user.username] = Date.now();
    updateTypingUsers(channel);
    var timeout = 10000; // 10sec
    setTimeout(() => {
      for (var u in lstTypingUser)
        if (lstTypingUser[u] + timeout - 2000 < Date.now()) {
          // clear old typing state users
          delete lstTypingUser[u];
        }

      updateTypingUsers(channel);
    }, timeout);
  }
});

$(document).ready(function () {
  // xử lý sự kiện logout
  $("#logouts").click(function () {
    handleLogout();
  });
});

function handleLogout() {
  // Emit logout event to server
  socket.emit("logout", { userId: getMe().id });

  // Ẩn khung chat
  $("#frame").css("display", "none");
  // Hiện phần tử ".limiter"
  $(".limiter").css("display", "block");
  // Clear user data from local storage or cookies
  localStorage.removeItem("hashedPass");
  localStorage.removeItem("userData"); // or any other user-related data

  // Optionally, you can also disconnect the socket
  socket.disconnect();
}

// ------------------------------------Các hàm  utilitie-------------------------------------

function updateTypingUsers(channel) {
  var typingSpan = $("#channel-user-typing");

  if (Object.keys(lstTypingUser).length > 0) {
    if (channel.p2p) typingSpan.html(`is typing...`);
    else {
      var names = Object.getOwnPropertyNames(lstTypingUser);
      var usernames = names.slice(0, 3).join(", ");
      if (names.length > 3) usernames += " and others are";
      else if (names.length <= 1) usernames += " is";
      else usernames += " are";

      typingSpan.html(`${usernames} typing...`);
    }

    typingSpan.css("display", "flex");
  } else {
    typingSpan.css("display", "none");
  }
}

function reqChatBy(name) {
  $(`#${name}`).find(".wait").css("display", "block");
  var channel = getChannels()[name];

  if (channel && channel.channelKey) {
    // tôi đã tham gia trò chuyện
    chatStarted(name);
  } else {
    socket.emit("request", { channel: name, pubKey: keys.publicKey });
  }
}

function getUserLink(user, channel) {
  return `<div class='wrap' onclick='reqChatBy("${channel}")'>
				<span class='contact-status ${user.status}'></span>
				<img src='${user.avatar}' />
				<div class='wait'></div>
				<div class='meta'>
					<p class='name badge' data-badge=''>${user.username}</p>
				</div>
			</div>`;
}

function getChannelLink(channel) {
  return `<div class='wrap' onclick='reqChatBy("${channel.name}")'>				
				<img src='img/channel.png' />
				<div class='wait'></div>
				<div class='meta'>
					<p class='name badge' data-badge=''>${channel.name}</p>
				</div>
			</div>`;
}

function getChannelName(userid) {
  var ids = [getMe().id, userid].sort();
  return `${ids[0]}_${ids[1]}`; // tên duy nhất cho người dùng này là riêng tư
}

// thiết lập luồng kênh an toàn
function setChannel(name, channel) {
  getChannels()[name] = channel;
  localStorage.channels = JSON.stringify(getChannels());
}

function getChannels() {
  if (channels) return channels;

  if (localStorage.channels) channels = JSON.parse(localStorage.channels);
  else {
    channels = {};
    localStorage.channels = "{}"; // Lưu chuỗi của đối tượng
  }

  return channels;
}

function setMe(data) {
  var lastMe = getMe();
  console.log("last me trong setme:  "+ lastMe);
  if (lastMe && lastMe.serverVersion !== data.serverVersion) {
    // Nếu thông tin người dùng hiện tại tồn tại và phiên bản máy chủ đã thay đổi
    // Máy chủ khởi động lại, nên làm mới dữ liệu đã lưu
    localStorage.channels = "{}"; // Làm mới dữ liệu các kênh
  }
  localStorage.me = JSON.stringify(data); // Lưu trữ thông tin người dùng mới vào localStorage
}

function getMe() {
  var me = localStorage.me;
  if (me == null) return null;

  return JSON.parse(me);
}
//check trang thai cua nguoi dung
function setConnectionStatus(state) {
  $("#profile-img").removeClass();

  if (state === "connected") {
    $("#profile-img").addClass("online");
  } else if (state === "disconnected") {
    $("#profile-img").addClass("offline");
  }
}

function chatStarted(channel) {
  currentChannelName = channel;
  $("li").removeClass("active");
  var contact = $(`#${channel}`);
  contact.addClass("active");
  contact.find(".badge").attr("data-badge", "");
  $("#channel-profile-img").attr("src", contact.find("img").attr("src"));
  $("#channel-profile-name").html(contact.find(".name").html());
  contact.find(".wait").css("display", "none");

  updateMessages();
}

function signedin(me) {
  console.info(`I signed-in by socket <${me.socketid}>`);
  setMe(me);
  $("title").html(`Secure Chat - ${me.username}`);
  $("#profile-img").attr("src", me.avatar);
  $("#myUsername").html(me.username);
  $("#myEmail").val(me.email);
  $(".limiter").remove();
  $("#frame").css("display", "block");
}
// Hàm cập nhật danh sách tin nhắn trên giao diện
function updateMessageList(messages) {
  // Xóa danh sách tin nhắn hiện tại
  const messageContainer = document.getElementById("messageContainer");
  messageContainer.innerHTML = '';

  // Thêm các tin nhắn mới
  messages.forEach(msg => {
    const messageElement = document.createElement("div");
    messageElement.className = "message";
    messageElement.innerText = msg.msg; // Giả sử msg.msg chứa nội dung tin nhắn
    messageContainer.appendChild(messageElement);
  });
}
// Lắng nghe sự kiện updateMessages từ server
socket.on("updateMessages", (data) => {
  if (data.channelName === currentChannel) {
    updateMessageList(data.messages);
  }
});

function updateMessages() {
  // Hiển thị các tin nhắn cũ
  var messages = getMessages(currentChannelName);

  // Thêm tất cả các tin nhắn vào màn hình
  var lstMessagesDom = $(".messages ul");
  lstMessagesDom.empty(); // Xóa màn hình
  for (var i in messages) {
    appendMessage(messages[i]);
  }
}

function newMessage() {
  const message = $(".message-input input").val();
  if ($.trim(message) == "") {
      console.log("message rỗng:");
    return false;
  }

  if (currentChannelName == null || currentChannelName == "") {
    alert("Please first select a chat to sending message!");
     console.log("currentChannelName rỗng:");
    return false;
  }
  // Lấy khóa đối xứng của kênh và mã hóa tin nhắn
  const chatSymmetricKey = getChannels()[currentChannelName].channelKey;
  const Encryptmsg = message.symEncrypt(chatSymmetricKey);

  // Gửi tin nhắn đến kênh trò chuyện
  socket.emit("msg", {
    msg: Encryptmsg,
    from: getMe().id,
    to: currentChannelName,
    avatar: getMe().avatar,
  });

  // Log tin nhắn đã mã hóa và các key vào console
  console.log("Chat Symmetric Key: " + chatSymmetricKey);
  console.log("Message: " + message);
  console.log("Encrypted message:", Encryptmsg);
  console.log("Private Key:", keys.privateKey);
  console.log("Public Key:", keys.publicKey);

  // Xóa nội dung trong ô nhập tin nhắn
  $(".message-input input").val(null);
  $(".message-input input").focus();
}

function appendMessage(data) {
  if (data.from == getMe().id) {
    data.state = "sent";
    data.name = getMe().username;
  } else {
    data.state = "replies";
    data.name = lstUsers[data.from].username;
  }

  data.msgHeader = "";
  if (lstChannels[data.to]) {
    // Nếu là kênh thực
    data.msgHeader = `<b>${data.name}</b><br />`;
  }

  // Lấy khóa đối xứng của kênh này để giải mã tin nhắn
  var symmetricKey = getChannels()[currentChannelName].channelKey;
  var msg = data.msg.symDecrypt(symmetricKey);

  var messagesScreen = $(".messages");
  messagesScreen
    .find("ul")
    .append(
      `<li class="${data.state}"><img src="${data.avatar}" title="${data.name}" /><p>${data.msgHeader}${msg}</p></li>`
    ); // Thêm tin nhắn vào cuối trang
  messagesScreen.scrollTop(messagesScreen[0].scrollHeight); // scroll to end of messages page
}
// nhận tin nhắn
function getMessages(channel) {
  var msgArray = channelMessages[channel];
  if (msgArray == null) {
    // Lấy từ máy chủ
    socket.emit("fetch-messages", channel);
    return [];
  } else return msgArray;
}
// tạo một kênh mới
function createChannel(channel, p2p) {
  if (lstChannels[channel]) return false;
  // Tạo khóa đối xứng
  var symmetricKey = generateKey(50);
  //
  // Lưu kênh này vào danh sách kênh của tôi
  setChannel(channel, { name: channel, p2p: p2p, channelKey: symmetricKey });

  return true;
}

// Tạo mật khẩu nonce bằng socket.id
function getNoncePassword(pass) {
  return pass.symEncrypt(socket.id);
}

(function ($) {
  ("use strict");

  /*==================================================================
	[ Mở rộng hồ sơ ]*/
  $(".expand-button").click(function () {
    $("#profile").toggleClass("expanded");
    $("#contacts").toggleClass("expanded");
  });

  /*==================================================================
	[ Ấn Enter để gửi tin nhắn ]*/
  $(".submit").click(function () {
    newMessage();
  });

  $(window).on("keydown", function (e) {
    // Thông báo người dùng đang nhập...
    if (currentChannelName != null && currentChannelName.length > 0)
      socket.emit("typing", currentChannelName);

    if (e.which == 13) {
      newMessage();
    }
  });

  /*==================================================================
	[ Ấn Enter để đăng nhập ]*/
  $(".validate-login").on("keydown", function (e) {
    if (e.which == 13) {
      $("#loginButton").click();
    }
  });

  $(".input100").each(function () {
    $(this).on("blur", function () {
      if ($(this).val().trim() != "") {
        $(this).addClass("has-val");
      } else {
        $(this).removeClass("has-val");
      }
    });
  });

  /*==================================================================
	[ nút tạo kênh ]*/
  $("#addchannel").on("click", () => {
    var name = prompt("Please enter channel name:", "Channel");
    if (name) {
      name = name.replace(/ /g, "_");
      if (createChannel(name, false)) {
        socket.emit("createChannel", name);
      } else {
        alert(`The <${name}> channel name already exist`);
      }
    }
  });

  /*==================================================================
	[ Xác thực ]*/
  var registerInputs = $(".validate-register .input100");
  var loginInputs = $(".validate-login .input100");

  $("#registerButton").on("click", () => {
    console.log("Register button clicked");
    // Xác thực dữ liệu
    var check = true;
    for (var i = 0; i < registerInputs.length; i++) {
      if (validate(registerInputs[i]) == false) {
        showValidate(registerInputs[i]);
        check = false;
      }
    }
    console.log(check + "1");
    if (check) {
      console.log(check + "2");
      // Nếu dữ liệu đăng nhập hợp lệ thì:
      var name = $.trim($("#registerName").val());
      var email = $("#registerEmail").val();
      var pass = $("#registerPass").val();

      localStorage.hashedPass = pass.getHash(); // lưu trữ mật khẩu đc băm
      var noncePass = getNoncePassword(localStorage.hashedPass);

      console.log("Registered username: " + name);
      console.log("Registered user email: " + email);
      console.log("Registered user password: " + pass);
      console.log("Hash the password using SHA-512: " + pass.getHash());
      console.log(
        "The hash function is encrypted with 3DES to send to the server: " +
          getNoncePassword(pass.getHash())
      );

      socket.emit("register", {
        username: name,
        email: email,
        password: noncePass,
      });
      // Lưu thông tin người dùng vào localStorage
      var userData = {
        username: name,
        email: email,
        password: noncePass
        // Các thông tin khác của người dùng nếu cần
      };
      localStorage.me = JSON.stringify(userData);
    }
  });

  $("#loginButton").on("click", () => {
    console.log("login button clicked");
    // Xác thực dữ liệu
    var check = true;
    for (var i = 0; i < loginInputs.length; i++) {
      if (validate(loginInputs[i]) == false) {
        showValidate(loginInputs[i]);
        check = false;
      }
    }

    if (check) {
      // Nếu dữ liệu đăng nhập hợp lệ thì:
      var email = $("#loginEmail").val();
      var pass = $("#loginPass").val();

      localStorage.hashedPass = pass.getHash(); // lưu trữ mật khẩu đc băm
      var noncePass = getNoncePassword(localStorage.hashedPass);

      console.log("Login user email: " + email);
      console.log("Login user password: " + pass);
      console.log("Hash the password using SHA-512: " + pass.getHash());
      console.log(
        "The hash function is encrypted with 3DES to send to the server: " +
          getNoncePassword(pass.getHash())
      );

      socket.emit("login", {
        email: email,
        password: noncePass,
      });
    }
  });

  $(".validate-form .input100").each(function () {
    $(this).focus(function () {
      hideValidate(this);
    });
  });

  $(".validate-register .input100").each(function () {
    $(this).focus(function () {
      hideValidate(this);
    });
  });
  $(".validate-login .input100").each(function () {
    $(this).focus(function () {
      hideValidate(this);
    });
  });
  function validate(input) {
    if ($(input).attr("type") == "email" || $(input).attr("name") == "email") {
      if (
        $(input)
          .val()
          .trim()
          .match(
            /^([a-zA-Z0-9_\-\.]+)@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.)|(([a-zA-Z0-9\-]+\.)+))([a-zA-Z]{1,5}|[0-9]{1,3})(\]?)$/
          ) == null
      ) {
        return false;
      }
    } else {
      if ($(input).val().trim() == "") {
        return false;
      }
    }
  }

  function showValidate(input) {
    var thisAlert = $(input).parent();

    $(thisAlert).addClass("alert-validate");
  }

  function hideValidate(input) {
    var thisAlert = $(input).parent();

    $(thisAlert).removeClass("alert-validate");
  }

  // Toggle between register and login forms
  $("#registerLink").on("click", (e) => {
    e.preventDefault();
    $("#loginForm").hide();
    $("#registerForm").show();
  });

  $("#loginLink").on("click", (e) => {
    e.preventDefault();
    $("#registerForm").hide();
    $("#loginForm").show();
  });

})(jQuery);

