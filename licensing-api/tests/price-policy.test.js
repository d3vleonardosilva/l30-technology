import test from "node:test";
import assert from "node:assert/strict";

import { isApprovedOneTimePrice } from "../src/index.js";

const validPrice = () => ({
  id: "pri_0123456789abcdefghijklmnop",
  status: "active",
  type: "standard",
  billing_cycle: null,
  trial_period: null,
  unit_price: {
    amount: "1999",
    currency_code: "USD"
  },
  unit_price_overrides: []
});

test("accepts the intended one-time USD 19.99 price", () => {
  assert.equal(
    isApprovedOneTimePrice(validPrice(), "pri_0123456789abcdefghijklmnop"),
    true
  );
});

test("rejects recurring prices", () => {
  const price = validPrice();
  price.billing_cycle = { interval: "year", frequency: 1 };
  assert.equal(
    isApprovedOneTimePrice(price, "pri_0123456789abcdefghijklmnop"),
    false
  );
});

test("rejects a price with a trial period", () => {
  const price = validPrice();
  price.trial_period = { interval: "day", frequency: 7 };
  assert.equal(
    isApprovedOneTimePrice(price, "pri_0123456789abcdefghijklmnop"),
    false
  );
});

test("rejects wrong amount or currency", () => {
  const wrongAmount = validPrice();
  wrongAmount.unit_price.amount = "2000";
  assert.equal(
    isApprovedOneTimePrice(wrongAmount, "pri_0123456789abcdefghijklmnop"),
    false
  );

  const wrongCurrency = validPrice();
  wrongCurrency.unit_price.currency_code = "BRL";
  assert.equal(
    isApprovedOneTimePrice(wrongCurrency, "pri_0123456789abcdefghijklmnop"),
    false
  );
});

test("rejects country overrides and inactive or unexpected prices", () => {
  const override = validPrice();
  override.unit_price_overrides = [{ country_codes: ["BR"], unit_price: { amount: "9900", currency_code: "BRL" } }];
  assert.equal(
    isApprovedOneTimePrice(override, "pri_0123456789abcdefghijklmnop"),
    false
  );

  const archived = validPrice();
  archived.status = "archived";
  assert.equal(
    isApprovedOneTimePrice(archived, "pri_0123456789abcdefghijklmnop"),
    false
  );

  assert.equal(isApprovedOneTimePrice(validPrice(), "pri_other"), false);
  assert.equal(isApprovedOneTimePrice(null, "pri_0123456789abcdefghijklmnop"), false);
});
