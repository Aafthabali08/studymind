import { expect, it } from "vitest";
import { authDomainFor } from "../src/firebase";
import { inAppBrowser } from "../src/auth";

const at = (url) => new URL(url);
const configured = "studymind-f3557.firebaseapp.com";

it("signs in on the app's own Firebase Hosting domain", () => {
  expect(authDomainFor(configured, at("https://studymind-f3557.web.app/x"), false)).toBe(
    "studymind-f3557.web.app",
  );
  expect(authDomainFor(configured, at("https://studymind-f3557.firebaseapp.com"), false)).toBe(
    "studymind-f3557.firebaseapp.com",
  );
});

it("uses the site's domain elsewhere only when it proxies /__/auth", () => {
  const render = at("https://studymind.onrender.com/");
  expect(authDomainFor(configured, render, false)).toBe(configured);
  expect(authDomainFor(configured, render, true)).toBe("studymind.onrender.com");
});

it("keeps the configured domain for local development", () => {
  expect(authDomainFor(configured, at("http://127.0.0.1:5173/"), true)).toBe(configured);
  expect(authDomainFor(configured, null, true)).toBe(configured);
});

it("recognises in-app browsers where Google sign-in cannot work", () => {
  expect(inAppBrowser("Mozilla/5.0 (iPhone) Instagram 300.0")).toBe(true);
  expect(inAppBrowser("Mozilla/5.0 (Linux; Android 14; wv) [FBAN/FB4A;FBAV/400]")).toBe(true);
  expect(inAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
  expect(inAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140 Mobile Safari/537.36")).toBe(false);
});
