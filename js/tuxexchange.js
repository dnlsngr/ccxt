'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, ArgumentsRequired, NotSupported, AuthenticationError, InsufficientFunds, OrderNotFound, BadRequest } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class fcoin extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'tuxexchange',
            'name': 'Tux Exchange',
            'countries': ['CN'],
            'version': '',
            'accounts': undefined,
            'accountsById': undefined,
            'hostname': 'tuxexchange.com/api',
            'has': {
                'CORS': true, // Right? https://tuxexchange.com/api?method=getticker
                'fetchCurrencies': true,
                // 'fetchTradingLimits': true, // TODO: not documented, not responsive, might leave it out
                'fetchTradingFee': true,
                // 'fetchFundingLimits': true, // TODO: not documented, not responsive, might leave it out
                'fetchTicker': true, // ALGO: I'm filtering fetchTickers, there is no direct endpoint, but I think this endpoint is important enough to leave this
                'fetchTickers': true,
                'fetchTrades': true,
                'fetchBalance': true,
                'createOrder': true,
                'cancelOrder': true,
                'fetchOpenOrders': true,
                'fetchMyTrades': true,
                'fetchDepositAddress': true,
                'fetchWithdrawals': true,
                'fetchDeposits': true,
                'fetchClosedOrders': false,
                'fetchL2OrderBook': false,
                'fetchOHLCV': false,
                'fetchOrder': false,
                'editOrder': false,
                'fetchTransactions': false,
                'fetchLedger': false,
                'withdraw': false,
            },
            'urls': {
                'logo': 'https://www.tuxexchange.com/images/kittytrade.png',
                'api': 'https://www.tuxexchange.com/api',
                'www': 'https://www.tuxexchange.com',
                'doc': 'https://www.tuxexchange.com/docs',
                'fees': 'https://www.tuxexchange.com/faq',
            },
            'api': { //  All methods are passed in as query params
                'public': { 'get': [''] },
                'private': { 'post': [''] },
            },
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'maker': 0,
                    'taker': 0.3,
                },
            },
        });
    }

    async fetchMarkets () {
        const tickerRes = await this.publicGet ({ 'method': 'getticker' });
        const tickers = JSON.parse (tickerRes);
        const coinRes = await this.publicGet ({ 'method': 'getcoins' });
        const coinResponse = JSON.parse (coinRes);
        const tickerKeyValues = Object.entries (tickers);
        let result = [];
        for (let i = 0; i < tickerKeyValues.length; i++) {
            const tickerKV = tickerKeyValues[i];
            const id = tickerKV[0];
            const tickerData = tickerKV[1];
            const splitId = id.split ('_');
            const baseId = splitId[0]; // base
            const quoteId = splitId[1]; // quote
            const base = this.commonCurrencyCode (baseId);
            const quote = this.commonCurrencyCode (quoteId);
            const active = tickerData.isFrozen === 0;
            const coinData = coinResponse[quoteId];
            const market = {
                'id': id,
                'symbol': base + '/' + quote,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'active': active,
                'maker': coinData['makerfee'],
                'taker': coinData['takerfee'],
                // precision: precision, // TODO: not listed? infer?
                'info': tickerData,
                // limits: limits,
            };
            result.push (market);
        }
        return result;
    }

    async fetchCurrencies () {
        const res = await this.publicGet ({ 'method': 'getcoins' });
        const resJson = JSON.parse (res);
        let coinKeyValues = Object.entries (resJson);
        // The API does not expose BTC as a coin (I suspect because it is the base in each market)
        let result = { 'BTC': { // ALGO: hardcoded this
            'id': 'BTC',
            'code': 'BTC',
            'name': 'bitcoin',
            'fiat': false,
        }};
        for (let i = 0; i < coinKeyValues.length; i++) {
            const coinKeyValue = coinKeyValues[i];
            const id = coinKeyValue[0];
            const coinData = coinKeyValue[1];
            const code = this.commonCurrencyCode (coinKeyValue[0]);
            result[code] = {
                'id': id,
                'code': code,
                'name': coinData['name'],
                'fiat': false,
                'funding': {
                    'withdraw': {
                        'fee': this.safeFloat (coinData, 'withdrawfee'),
                    },
                },
            };
        }
        return result;
    }

    fetchTradingLimits () {
        // TODO
    }

    fetchTradingFees () {
        return {
            'maker': 0,
            'taker': 0.03,
        };
    }

    fetchFundingLimits () {
        // TODO
    }

    async fetchTicker (symbol) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchTicker () requires a "symbol" argument');
        }
        let res = await this.publicGet ({ 'method': 'getticker' });
        const resJson = JSON.parse (res);
        let tickerKeyValues = Object.entries (resJson);
        for (let i = 0; i < tickerKeyValues.length; i++) {
            const tickerResult = this.parseTicker (tickerKeyValues[i]);
            const tickerSymbol = tickerResult['symbol'];
            if (tickerSymbol === symbol) {
                return tickerResult;
            }
        }
        return null; // TODO error handling
    }

    async fetchTickers () {
        await this.loadMarkets ();
        let res = await this.publicGet ({ 'method': 'getticker' });
        const resJson = JSON.parse (res);
        let tickerKeyValues = Object.entries (resJson);
        const result = {};
        for (let i = 0; i < tickerKeyValues.length; i++) {
            const tickerResult = this.parseTicker (tickerKeyValues[i]);
            const symbol = tickerResult['symbol'];
            result[symbol] = tickerResult;
        }
        return result;
    }

    parseTicker (tickerKeyValue) {
        const timestamp = this.nonce (); // TODO: hopefully this approximation is sufficient
        const marketId = tickerKeyValue[0];
        const market = this.findMarket (marketId);
        const ticker = tickerKeyValue[1];
        // ALGO: all the values here check out, but there are a lot of undefineds
        return {
            'symbol': market['symbol'],
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'close': this.safeFloat (ticker, 'last'),
            'last': this.safeFloat (ticker, 'last'),
            'high': this.safeFloat (ticker, 'high24hr'),
            'low': this.safeFloat (ticker, 'low24hr'),
            'percentage': this.safeFloat (ticker, 'percentChange'),
            'baseVolume': this.safeFloat (ticker, 'baseVolume'),
            'quoteVolume': this.safeFloat (ticker, 'quoteVolume'),
            'bid': this.safeFloat (ticker, 'highestBid'),
            'ask': this.safeFloat (ticker, 'lowestAsk'),
            'bidVolume': undefined,
            'askVolume': undefined,
            'vwap': undefined,
            'open': undefined,
            'previousClose': undefined,
            'change': undefined,
            'average': undefined,
            'info': ticker,
        };
    }

    async fetchOrderBook (symbol, limit) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOrderBook () requires a symbol argument');
        }
        await this.loadMarkets ();
        const codes = this.getIdsFromSymbol (symbol);
        if (codes.base !== 'BTC') {
            throw new NotSupported (this.id + ' this exchange only trades on symbols with BTC as base');
        }
        if (limit !== undefined) {
            throw new NotSupported (this.id + ' fetchOrderBook () does not support a "limit" argument for this exchange');
        }
        let orderBookRequest = {
            'coin': this.currencyId (codes.quote),
            'method': 'getorders',
        };
        const response = await this.publicGet (orderBookRequest);
        const responseJson = JSON.parse (response);
        const bidsAsStrings = responseJson.bids;
        const asksAsStrings = responseJson.asks;
        const bids = this.parseBidsAsks (bidsAsStrings);
        const asks = this.parseBidsAsks (asksAsStrings);
        // Sort bids by descending price
        bids.sort ((bid1, bid2) => (bid2[0] - bid1[0]));
        // Sort asks by ascending price
        asks.sort ((ask1, ask2) => (ask1[0] - ask2[0]));
        const result = {
            'bids': bids,
            'asks': asks,
            'datetime': null,
            'timestamp': null,
            'nonce': null,
        };
        return result;
    }

    parseTrade (trade, market) {
        // The API exposees different fields for the gettrades and getmytradehistory endpoints
        const isPrivateTrade = trade['orderId'] !== undefined;
        const tradeDate = new Date (this.safeString (trade, 'date'));
        const timestamp = tradeDate.valueOf ();
        let priceString = null
        if (isPrivateTrade) {
            priceString = this.safeString (trade, 'price')
        } else {
            priceString = this.safeString (trade, 'rate');
        }
        const parsedTrade = {
            'id': this.safeString (trade, 'tradeid'),
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': market.id,
            'type': 'limit',
            'side': this.safeString (trade, 'type'),
            'price': this.asFloat (priceString),
            'amount': this.asFloat (this.safeString (trade, 'amount')),
            'cost': this.asFloat (this.safeString (trade, 'total')),
        };
        if (isPrivateTrade) {
            let feeCurrency;
            if (parsedTrade.side === 'buy') {
                feeCurrency = this.commonCurrencyCode (this.safeString (trade, 'market'))
            } else {
                feeCurrency = this.commonCurrencyCode (this.safeString (trade, 'coin'));
            }
            return Object.assign (parsedTrade, {
                'order': this.safeString (trade, 'order'),
                'fee': {
                    'cost': this.safeFloat (trade, 'total'),
                    'currency': feeCurrency,
                    'rate': this.safeFloat (trade, 'feepercent'),
                },
            });
        } else {
            return parsedTrade;
        }
    }

    async fetchTrades (symbol, since, limit) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchTrades () requires a "symbol" argument');
        }
        await this.loadMarkets ();
        const codes = this.getIdsFromSymbol (symbol);
        if (codes['base'] !== 'BTC') {
            throw new NotSupported (this.id + ' this exchange only trades on symbols with BTC as base');
        }
        let tradeHistoryRequest = {
            'method': 'gettradehistory',
            'coin': this.currencyId (codes.quote),
            'start': Math.floor (since / 1000),
            'end': this.seconds (),
        };
        const resp = await this.publicGet (tradeHistoryRequest);
        const trades = JSON.parse (resp);
        const market = this.getMarket (symbol);
        const results = this.parseTrades (trades, market, since, limit);
        // API does not return trades time sorted
        results.sort ((trade1, trade2) => trade1['timestamp'] - trade2['timestamp']);
        return results;
    }

    async fetchBalance () {
        await this.loadMarkets ();
        let res = await this.privatePost ({ 'method': 'getmybalances' });
        const balances = JSON.parse (res);
        let balanceKeyValues = Object.entries (balances);
        let result = { 'info': balances };
        for (let i = 0; i < balanceKeyValues.length; i++) {
            const balanceKeyValue = balanceKeyValues[i];
            const currency = balanceKeyValue[0];
            const balanceData = balanceKeyValue[1];
            const uppercase = currency.toUpperCase ();
            const code = this.commonCurrencyCode (uppercase);
            let account = this.account ();
            account['total'] = parseFloat (balanceData['balance']);
            account['used'] = parseFloat (balanceData['frozen']);
            account['free'] = parseFloat (balanceData['balance'] - balanceData['frozen']);
            result[code] = account;
        }
        return result;
    }

    async createOrder (symbol, type, side, amount, price) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' createOrder () requires a "symbol" argument');
        }
        if (price === undefined) {
            throw new ArgumentsRequired (this.id + ' createOrder () requires a "price" argument');
        }
        if (type !== 'limit') {
            throw new NotSupported (this.id + ' fetchTrades () does not support a "limit" argument for this exchange');
        }
        if (side !== 'buy' || side !== 'sell') {
            throw new BadRequest (this.id + ' "side" must be a string containing either "buy" or "sell"');
        }
        await this.loadMarkets (); // TODO: needed everywhere?
        const codes = this.getIdsFromSymbol (symbol);
        amount = this.amountToPrecision (symbol, amount);
        let orderRequest = {
            'market': this.currencyId (codes.base),
            'coin': this.currencyId (codes.quote),
            'amount': amount,
            'price': price,
        };
        orderRequest['price'] = this.priceToPrecision (symbol, price);
        if (side === 'buy') {
            orderRequest = Object.assign (orderRequest, { 'method': 'buy' });
        } else if (side === 'sell') {
            orderRequest = Object.assign (orderRequest, { 'method': 'sell' });
        }
        const result = await this.privatePost (orderRequest);
        const orderId = result['success'];
        return {
            'id': orderId,
            'info': result,
            'timestamp': undefined,
            'datetime': undefined,
            'lastTradeTimestamp': undefined,
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': undefined,
            'average': undefined,
            'filled': undefined,
            'remaining': undefined,
            'status': undefined,
            'fee': undefined,
            'trades': undefined,
        };
    }

    async cancelOrder (id, symbol) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' cancelOrder () requires a "symbol" argument');
        }
        await this.loadMarkets ();
        const ids = this.getIdsFromSymbol (symbol);
        const cancelRequest = {
            'method': 'cancelorder',
            'id': id,
            'market': this.currencyId (ids.base),
        };
        const result = await this.privatePost (cancelRequest);
        return { 'info': result };
    }

    parseOrder (order) {
        const symbol = this.findSymbol (this.safeString (order, 'market_pair'));
        const orderDate = new Date (this.safeString (order, 'date'));
        const timestamp = orderDate.valueOf ();
        const amount = this.asFloat (this.safeString (order, 'amount'));
        const filled_amount = this.asFloat (this.safeString (order, 'filledamount'));
        return {
            'info': order,
            'id': this.safeString (order, 'id'),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': 'limit',
            'side': this.safeString (order, 'type'),
            'price': this.asFloat (this.safeString (order, 'price')),
            'amount': amount,
            'remaining': amount - filled_amount,
            'filled': filled_amount,
            'status': 'open',
            'lastTradeTimestamp': undefined,
        };
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined) {
        await this.loadMarkets ();
        const openOrdersResp = await this.privatePost ({ 'method': 'getmyopenorders' });
        const openOrderMap = JSON.parse (openOrdersResp);
        const openOrders = Object.values (openOrderMap);
        let market = undefined;
        if (symbol !== undefined) {
            market = this.getMarket (symbol);
        }
        const result = this.parseOrders (openOrders, market, since, limit);
        return result;
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined) {
        const tradeHistoryResp = await this.privatePost ({ 'method': 'getmytradehistory' });
        const myTrades = JSON.parse (tradeHistoryResp);
        let results = this.parseTrades (myTrades, symbol, since, limit);
        // API does not return trades time sorted
        results.sort ((trade1, trade2) => (trade1['timestamp'] - trade2['timestamp']));
        return results;
    }

    async fetchDepositAddress (code) {
        if (code === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchDepositAddress () requires a code argument');
        }
        await this.loadMarkets ();
        const addressesResp = await this.privatePost ({ 'method': 'getmyaddresses' });
        const addressesJson = JSON.parse (addressesResp);
        const addresses = addressesJson['addresses'];
        const addressForCode = addresses[this.currencyId (code)];
        return {
            'currency': code,
            'address': this.checkAddress (addressForCode),
            'info': addressForCode,
        };
    }

    parseTransaction (transaction, type) {
        const transactionDate = new Date (this.safeString (transaction, 'date'));
        const timestamp = transactionDate.valueOf ();
        const marketStatus = this.safeString (transaction, 'status');
        const status = marketStatus === 'success' ? 'ok' : marketStatus;
        return {
            'info': transaction,
            'id': this.safeString (transaction, 'txid'), // Exchange doesn't provide its own id
            'txid': this.safeString (transaction, 'txid'),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'address': this.safeString (transaction, 'address'),
            'type': type,
            'amount': this.asFloat (this.safeString (transaction, 'amount')),
            'currency': this.commonCurrencyCode (this.safeString (transaction, 'coin')),
            'status': status,
            'updated': undefined,
            'tag': undefined,
            'fee': undefined,
        };
    }

    async fetchDeposits (code = undefined, since = undefined, limit = undefined) {
        await this.loadMarkets ();
        let res = await this.privatePost ({ 'method': 'getmydeposithistory' });
        const deposits = JSON.parse (res);
        // Some deposits seem to have no data associated
        const validDeposits = [];
        for (let i = 0; i < deposits.length; i++) {
            const deposit = deposits[i];
            if (deposit.txid !== null) {
                validDeposits.push (deposit);
            }
        }
        const result = this.parseTransactions (validDeposits, code, since, limit, { 'type': 'deposit' });
        return result;
    }

    async fetchWithdrawals (code = undefined, since = undefined, limit = undefined) {
        await this.loadMarkets ();
        let res = await this.privatePost ({ 'method': 'getmywithdrawhistory' });
        const withdrawals = JSON.parse (res);
        // Some withdrawals seem to have no data associated
        const validWithdrawals = [];
        for (let i = 0; i < withdrawals.length; i++) {
            const withdrawal = withdrawals[i];
            if (withdrawal.txid !== null) {
                validWithdrawals.push (withdrawal);
            }
        }
        const result = this.parseTransactions (validWithdrawals, code, since, limit, { 'type': 'withdrawal' });
        return result;
    }

    async withdraw (code, amount, address) {
        if (code === undefined || amount === undefined || address === undefined) {
            throw new ArgumentsRequired (this.id + ' withdraw () requires a code, amount and address argument');
        }
        if (address.indexOf ('0x') === 0) {
            address = address.substr (2);
        }
        const withdrawRequest = {
            'method': 'withdraw',
            'coin': this.currencyId (code),
            'address': address,
            'amount': amount,
        };
        const result = await this.privatePost (withdrawRequest);
        return { 'info': result };
    }

    nonce () {
        return this.seconds ();
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'];
        const query = this.omit (params, this.extractParams (path));
        let urlQueryParams = this.urlencode (query);
        if (api === 'private') {
            if (!headers) {
                headers = {};
            }
            const nonce = this.nonce ();
            urlQueryParams += '&nonce=' + nonce;
            // Encoding the query params is non-standard and poorly documented but somehow correct
            headers = Object.assign (headers, {
                'Key': this.apiKey,
                'Sign': this.hmac (urlQueryParams, this.secret, 'sha512', 'hex'),
            });
        }
        if (Object.keys (query).length) {
            url += '?' + urlQueryParams;
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    getIdsFromSymbol (symbol) {
        const splitSymbol = symbol.split ('/');
        return {
            'base': splitSymbol[0],
            'quote': splitSymbol[1],
        };
    }

    handleErrors (code, reason, url, method, headers, body) {
        if (code >= 400) {
            // Tux currently doesn't send anything other than 200s, but should keep an eye out
            throw new ExchangeError (this.id + ' unexpected exchange error with code: ' + code);
        }
        if (typeof body !== 'string' || body.length < 2 || (body[0] !== '[' && body[0] !== '{')) {
            // Haven't seen any body-less responses from tux, but best to not explode if that changes
            return;
        }
        const response = JSON.parse (body);
        // Response code is always 200, errors will have specific exceptions
        if (response['success'] === 0) {
            const errorBody = response['error'];
            // Exceptions are not ennumerated in tux documentation so just identify ones found in development
            if (errorBody === 'Authentication failed.' || errorBody === 'Invalid public key.') {
                throw new AuthenticationError (this.id + ' ' + body);
            } else if (errorBody === 'Order not found.') {
                throw new OrderNotFound (this.id + ' no order found. Check that the order id and the base currency of the symbol are correct');
            } else if (errorBody === 'Inssuficient funds.' || errorBody === 'NSF.') {
                throw new InsufficientFunds (this.id + ' insufficient funds');
            } else if (errorBody === 'A request to withdraw has been made. Please check your email to complete this request.') {
                throw new ExchangeError (this.id + ' withdraw requests via the api will fail unless email confirmations are disabled in the UI under "Notifications"');
            } else {
                throw new ExchangeError (this.id + ' ' + errorBody);
            }
        }
    }
};
