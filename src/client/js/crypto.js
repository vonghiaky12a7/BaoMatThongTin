/* Cryptology sử dụng lib Forge.js để mã hóa/giải mã bằng thuật toán đối xứng hoặc bất đối xứng  */
"use strict";

// Tạo đối tượng mã hóa cho thuật toán RSA bất đối xứng.
var rsa = new JSEncrypt();

// định nghĩa các ký tự để chọn ký tự tạo thành khóa
var chars =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz*&-%/!?*+=()";

// tạo khóa cho RSA
// truyền vào độ dài khóa mong muốn
function generateKey(keyLength) {
  var randomstring = "";

  for (var i = 0; i < keyLength; i++) {
    var rnum = Math.floor(Math.random() * chars.length);
    randomstring += chars.substring(rnum, rnum + 1);
  }
  return randomstring;
}

// tạo cặp khóa công khai và khóa riêng cho mã hóa bất đối xứng
var generateKeyPair = function () {
  var crypt = new JSEncrypt({ default_key_size: 1024 });
  crypt.getKey();

  return {
    privateKey: crypt.getPrivateKey(),
    publicKey: crypt.getPublicKey(),
  };
};

// băm văn bản bằng thuật toán sha-512
String.prototype.getHash = function () {
  return CryptoJS.SHA512(this).toString();
};

// mã hóa 3DES
String.prototype.symEncrypt = function (pass) {
  return CryptoJS.TripleDES.encrypt(this, pass).toString();
};

// giải mã 3DES
String.prototype.symDecrypt = function (pass) {
  var bytes = CryptoJS.TripleDES.decrypt(this, pass);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// mã hóa rsa
String.prototype.asymEncrypt = function (publicKey) {
  rsa.setPublicKey(publicKey);
  return rsa.encrypt(this);
};

// giải mã rsa
String.prototype.asymDecrypt = function (privateKey) {
  rsa.setPrivateKey(privateKey); // Thiết lập khóa riêng.
  return rsa.decrypt(this);
};

// hàm lấy các khóa
function getCipherKeys() {
  var keys = localStorage.cipherKeys; // đọc khóa từ json
  if (keys == null) {
    keys = generateKeyPair();

    // lưu trữ khóa dưới dạng json trong localStorage
    localStorage.cipherKeys = JSON.stringify(keys);
    return keys;
  }

  return JSON.parse(keys);
}
