// server.js (ESM)
// package.json should include: { "type": "module" }

import express from "express";
import "dotenv/config";
import {
  ApiError,
  Client,
  Environment,
  LogLevel,
  OrdersController,
  PaypalExperienceUserAction,
} from "@paypal/paypal-server-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Env ---
const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PORT = 8080,
} = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET.");
  process.exit(1);
}

// --- PayPal SDK client ---
const client = new Client({
    clientCredentialsAuthCredentials: {
        oAuthClientId: PAYPAL_CLIENT_ID,
        oAuthClientSecret: PAYPAL_CLIENT_SECRET,
    },
    timeout: 0,
    environment: Environment.Sandbox,
    logging: {
        logLevel: LogLevel.Info,
        logRequest: { logBody: true }, 
        logResponse: { logHeaders: true },
    },
});

const ordersController = new OrdersController(client);

// --- Simple request logger (mask obvious PII) ---
// app.use((req, _res, next) => {
//   const masked = JSON.stringify(req.body || {})
//     .replace(/"email_address":"[^"]+"/g, '"email_address":"***"')
//     .replace(/"national_number":"[^"]+"/g, '"national_number":"***"');
//   console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${masked}`);
//   next();
// });

/**
 * Create an order to start the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_create
 */
const createOrder = async (cart, contactPreference) => {
    console.log("contactpref", contactPreference);
    const includeShipping = contactPreference !== "NO_CONTACT_INFO"; // Set the value of IncludeShipping only if contact pref is equal to retain or update
    if (!includeShipping) console.log("No contact info to pass");
   const collect = {
        body: {
            intent: "CAPTURE",
            purchaseUnits: [
                {
                    amount: {
                        currencyCode: "GBP",
                        value: "100.00",
                        breakdown: {
                            itemTotal: {
                                currencyCode: "GBP",
                                value: "100.00",
                            },
                        },
                    },
                    // lookup item details in `cart` from database
                    items: [
                        {
                            name: "T-Shirt",
                            unitAmount: {
                                currencyCode: "GBP",
                                value: "100.00",
                            },
                            quantity: "1",
                            description: "Super Fresh Shirt",
                            sku: "sku01",
                        },
                    ],
                     ...(includeShipping && { // If we want to include shipping...
                      // RETAIN only works if you include both emailAddress and phoneNumber below
                        shipping: {
                        // emailAddress:
                        //         "buyer_shipping_email@example.com", // Include this to make it uneditable in Retain contact module
                            phoneNumber: {
                                countryCode: "44",
                                nationalNumber: "4081111111",
                            },
                            name: {
                              full_name: "Hans Muller"
                            }, // The address is formatted incorrectly
                            // address: { // This is the passed shipping address
                            //   address_line_1: "2211 N First Street",
                            //   address_line_2: "Building 17",
                            //   admin_area_2: "San Jose",
                            //   admin_area_1: "CA",
                            //   postal_code: "95131",
                            //   countryCode: "US"
                            // },
                            options: [
                              {
                                id: "SHIP1",
                                type: "SHIPPING",
                                label: "Free Shipping",
                                selected: false,
                                amount: {
                                  currencyCode: "GBP",
                                  value: "0.00"
                                }
                              },
                              {
                                id: "SHIP2",
                                type: "SHIPPING",
                                label: "2-Day Shipping",
                                selected: false,
                                amount: {
                                  currencyCode: "GBP",
                                  value: "4.00"
                                }
                              },
                              {
                                id: "PICKUP0", //requires patch call with name prefixed with S2S
                                type: "PICKUP",
                                label: "Collect from Glasgow Store",
                                selected: true,
                                amount: {
                                  currencyCode: "GBP",
                                  value: "0.00"
                                }
                              },
                              {
                                id: "PICKUP1",
                                type: "PICKUP",
                                label: "Collect from London Store",
                                selected: false,
                                amount: {
                                  currencyCode: "GBP",
                                  value: "0.00"
                                }
                              }
                            ]
                        },
                    }),
                },
            ],
           paymentSource: {
                paypal: {
                    experienceContext: {
                        userAction: PaypalExperienceUserAction.PayNow,

                       contactPreference:
                            contactPreference,
                    },
                },
            },
        },
        prefer: "return=minimal",
    };
   
const { body, ...httpResponse } = await ordersController.createOrder(collect);
  return {
    jsonResponse: JSON.parse(body),
    httpStatusCode: httpResponse.statusCode,
  };
    
};



// --- Routes ---
// Create order (single endpoint for all three contact modes)

// ...
app.post("/api/orders", async (req, res) => {
  try {
    const cart = req.body.cart;
    const contactPreference = req.body.pref;
    console.log("cart", cart);
    console.log("contact pref", contactPreference);

    const { jsonResponse, httpStatusCode } = await createOrder(cart, contactPreference);
    res.status(httpStatusCode).json(jsonResponse);
    console.log("'createOrder'JSON Response Log: ", jsonResponse);  
} catch (err) {
    console.error("Failed to create order:", err);
    res.status(500).json({ error: "Failed to create order." }); 
  }
});



// Capture order
app.post("/api/orders/:orderID/capture", async (req, res) => {
  try {
    const { orderID } = req.params;
    const { body, ...http } = await ordersController.captureOrder({
      id: orderID,
      prefer: "return=minimal",
    });
    return res.status(http.statusCode).json(JSON.parse(body));
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Failed to capture order.";
    console.error("Capture error:", message);
    return res.status(500).json({ error: message });
  }
});

// Health check
// app.get("/health", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}/`);
});
