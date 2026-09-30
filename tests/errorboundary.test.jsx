import React from "react";
import { render, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import ErrorBoundary from "../src/ErrorBoundary";

function Boom({ message }) {
  throw new Error(message);
}

it("shows a recovery screen instead of a blank page", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom message="kaboom" />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
  expect(
    screen.getByRole("button", { name: "Reload StudyMind" }),
  ).toBeVisible();
});

it("explains a failed page download after an update", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom message="Failed to fetch dynamically imported module: /assets/AdminPage-x.js" />
    </ErrorBoundary>,
  );
  expect(
    screen.getByRole("heading", { name: "StudyMind was updated." }),
  ).toBeVisible();
});
