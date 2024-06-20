/* Tệp này được thực thi trong trình duyệt, khi người dùng truy cập / */
"use strict";

// các biến chứa dữ liệu cho mỗi người
var socket = io(), // kết nối tới socket
  lstUsers = {},
  lstChannels = null,
  currentChannelName = "",
  channelMessages = {},
  channels = null,
  state = ["offline", "online"], // 0: offline, 1: online
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

// khi phiên đăng nhập của tôi hết hạn từ thời gian máy chủ
socket.on("resign", () => {
  var me = getMe();
  $(".login100-form-title").html("Login");
  $("#yourName").val(me.username);
  $("#yourEmail").val(me.email);
  $("#yourAvatar").attr("src", me.avatar);
});

// khi tôi bị ngắt kết nối từ server, đổi trạng thái của tôi thành offline
socket.on("disconnect", () => {
  console.warn(`socket <${getMe().socketid}> disconnected!`);
  setConnectionStatus("disconnected");
});

// khi có ngoại lệ từ máy chủ gọi
socket.on("exception", (err) => {
  alert(err);
});

// lưu dữ liệu người dùng của tôi khi tôi đăng nhập thành công tới serve
socket.on("signed", signedin);

// cập nhật dữ liệu người dùng và kênh khi trạng thái của họ thay đổi
socket.on("update", (data) => {
  lstUsers = data.users;
  lstChannels = data.channels;
  $("#userContacts").empty();
  $("#channelContacts").empty();

  delete lstUsers[getMe().id]; // loại bỏ tôi khỏi danh sách người dùng
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
    $(`#${getChannelName(u.id)}`).html(getUserLink(u, chat));
  }
});

// khi một người dùng yêu cầu trò chuyện với tôi hoặc tham gia kênh mà tôi là admin
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
    // không tồn tại trong danh sách kênh, nên đây là một kênh p2p mới!
    // hỏi tôi chấp nhận hay từ chối yêu cầu người dùng
    if (
      confirm(`Do you allow <${reqUser.username}> to chat with you?`) == false
    ) {
      socket.emit("reject", { to: data.from, channel: data.channel });
      return;
    }
    // wow, accepted...
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
  socket.emit("accept", {
    to: data.from,
    channelKey: encryptedChannelKey,
    channel: reqChannel.name,
  });
  chatStarted(reqChannel.name);
});

// khi yêu cầu chat của tôi được chấp nhận bởi admin kênh
socket.on("accept", (data) => {
  // decrypt RSA cipher by my pricate key
  var symmetricKey = data.channelKey.asymDecrypt(keys.privateKey);
  //
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
  var reason = data.msg == null ? "" : "because " + data.msg;
  if (data.p2p)
    alert(`Your request to chat by <${admin.username}> rejected. ${reason}`);
  else
    alert(`Your join request to <${data.channel}> channel rejected. ${reason}`);

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
    badge.attr("data-badge", parseInt(badgeVal) + 1);
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

// ------------------------------------ utilitie functions -------------------------------------

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
    localStorage.channels = "{}"; // store string of object
  }

  return channels;
}

function setMe(data) {
  var lastMe = getMe();

  if (lastMe && lastMe.serverVersion !== data.serverVersion) {
    // server restarted, so refresh cached data
    localStorage.channels = "{}";
  }
  localStorage.me = JSON.stringify(data);
}

function getMe() {
  var me = localStorage.me;
  if (me == null) return null;

  return JSON.parse(me);
}

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
  contact.find(".badge").attr("data-badge", ""); // remove badge
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

function updateMessages() {
  // show old messages
  var messages = getMessages(currentChannelName);

  // add all messages to screen
  var lstMessagesDom = $(".messages ul");
  lstMessagesDom.empty(); // clear screen
  for (var i in messages) {
    appendMessage(messages[i]);
  }
}

function newMessage() {
  var message = $(".message-input input").val();
  if ($.trim(message) == "") {
    return false;
  }

  if (currentChannelName == null || currentChannelName == "") {
    alert("Please first select a chat to sending message!");
    return false;
  }

  // get channel symmetric key and encrypt message
  var chatSymmetricKey = getChannels()[currentChannelName].channelKey;
  var msg = message.symEncrypt(chatSymmetricKey);

  // Send the message to the chat channel
  socket.emit("msg", {
    msg: msg,
    from: getMe().id,
    to: currentChannelName,
    avatar: getMe().avatar,
  });

  // Empty the message input
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
    // if is a real channel
    data.msgHeader = `<b>${data.name}</b><br />`;
  }

  // get this channel symmetric key to decrypt message
  var symmetricKey = getChannels()[currentChannelName].channelKey;
  var msg = data.msg.symDecrypt(symmetricKey);

  // add to self screen
  var messagesScreen = $(".messages");
  messagesScreen
    .find("ul")
    .append(
      `<li class="${data.state}"><img src="${data.avatar}" title="${data.name}" /><p>${data.msgHeader}${msg}</p></li>`
    ); // append message to end of page
  messagesScreen.scrollTop(messagesScreen[0].scrollHeight); // scroll to end of messages page
}

function getMessages(channel) {
  var msgArray = channelMessages[channel];
  if (msgArray == null) {
    // fetch from server
    socket.emit("fetch-messages", channel);
    return [];
  } else return msgArray;
}

function createChannel(channel, p2p) {
  if (lstChannels[channel]) return false;

  // my socket is admin for this channel
  // generate symmetric key
  var symmetricKey = generateKey(50);
  //
  // store this channel to my channels list
  setChannel(channel, { name: channel, p2p: p2p, channelKey: symmetricKey });

  return true;
}

// create nonce password by socket.id
function getNoncePassword(pass) {
  return pass.symEncrypt(socket.id);
}

//
//
//
// ------------------------------------ Jquery DOM Events -------------------------------------
//
//
(function ($) {
  "use strict";

  /*==================================================================
	[ Expand profile ]*/
  $(".expand-button").click(function () {
    $("#profile").toggleClass("expanded");
    $("#contacts").toggleClass("expanded");
  });

  /*==================================================================
	[ Press Enter to send message ]*/
  $(".submit").click(function () {
    newMessage();
  });

  $(window).on("keydown", function (e) {
    // notify user is typing...
    if (currentChannelName != null && currentChannelName.length > 0)
      socket.emit("typing", currentChannelName);

    if (e.which == 13) {
      newMessage();
    }
  });

  /*==================================================================
	[ Press Enter to login ]*/
  $(".validate-input").on("keydown", function (e) {
    if (e.which == 13) {
      $("#loginButton").click();
    }
  });

  /*==================================================================
	[ Focus input ]*/
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
	[ Add channel button ]*/
  $("#addchannel").on("click", () => {
    var name = prompt("Please enter channel name:", "Channel");
    if (name) {
      name = name.replace(/ /g, "_"); // replace all space to _
      if (createChannel(name, false)) {
        // send data to requester user to join in current channel
        socket.emit("createChannel", name);
      } else {
        alert(`The <${name}> channel name already exist`);
      }
    }
  });

  /*==================================================================
	[ Validate ]*/
  var input = $(".validate-input .input100");

  // Submit login div
  $("#loginButton").on("click", () => {
    // validation data
    var check = true;
    for (var i = 0; i < input.length; i++) {
      if (validate(input[i]) == false) {
        showValidate(input[i]);
        check = false;
      }
    }

    if (check) {
      // if login data is valid then:
      var name = $.trim($("#yourName").val());
      var email = $("#yourEmail").val();
      var pass = $("#yourPass").val();

      localStorage.hashedPass = pass.getHash(); // store my login password by hashing
      var noncePass = getNoncePassword(localStorage.hashedPass);
      socket.emit("login", {
        username: name,
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
})(jQuery);

$(document).ready(function () {
  // Lắng nghe sự kiện click trên button "Register"
  $("#registerButton").click(function () {
    // Ẩn biểu mẫu đăng ký
    $("#registerForm").css("display", "none");
    // Hiển thị biểu mẫu đăng nhập
    $("#loginForm").css("display", "block");
  });

  // Lắng nghe sự kiện click trên thẻ "Login"
  $("#loginLink").click(function () {
    // Ẩn biểu mẫu đăng ký
    $("#registerForm").css("display", "none");
    // Hiển thị biểu mẫu đăng nhập
    $("#loginForm").css("display", "block");
  });

  // Lắng nghe sự kiện click trên thẻ "Register"
  $("#registerLink").click(function () {
    // Ẩn biểu mẫu đăng nhập
    $("#loginForm").css("display", "none");
    // Hiển thị biểu mẫu đăng ký
    $("#registerForm").css("display", "block");
  });

  // Sự kiện click cho nút "Register"
  $("#registerButton").click(function () {
    // Lấy giá trị username từ input của form register
    var username = $("#yourName").val();
    // Gán giá trị username vào input của form login
    $("#yourUsername").val(username);
  });
});
