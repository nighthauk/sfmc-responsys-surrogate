/**
 * @file Acts as the middleware advertising as a surrogate moving Oracle Responsys to Salesforce
 * @author Ryan Hauk <ryan@nighthauk.com>
 */
const _ = require('lodash');
const bodyParser = require('body-parser');
const xml2js = require('xml2js');
const axios = require('axios');
const express = require('express');
const xmlHelper = require('./xml-helper');
const app = express();
require('body-parser-xml')(bodyParser);

// Encrypted credential mapping
const apigee_token = process.env.FAUX_TOKEN;
const unauthorized = process.env.UNAUTHORIZED;
const brand1_clientid = process.env.BRAND1_CLIENTID;
const brand1_clientsecret = process.env.BRAND1_CLIENTSECRET;
const brand2_clientid = process.env.BRAND2_CLIENTID;
const brand2_clientsecret = process.env.BRAND2_CLIENTSECRET;

// Options passed into the body-parser, uses xml2js internally
const options = {
    xmlParseOptions: {
        normalize: true
        , normalizeTags: true
        , explicitRoot: false
        , explicitArray: false
        , tagNameProcessors: [xml2js.processors.stripPrefix]
    }
};

// Setup some defaults for our app and axios
axios.defaults.headers.post['Content-Type'] = 'application/json';
app.use(bodyParser.xml(options));

// Defining the base POST route for the send
// This acts as a service to mock what Responsys is expecting
app.post('/', (req, res, next) => {
    const { body, header = {} } = req.body;
    const { sessionid } = header.sessionheader || {};
    const { username, password } = body.login || {};
    const destroy = body.logout || false;
    const { recorddata, triggerdata, campaign } = body.mergetriggeremail || {};
    const brand_map = {
        'BRAND1': { 'clientId': brand1_clientid, 'clientSecret': brand1_clientsecret }
        , 'BRAND2': { 'clientId': brand2_clientid, 'clientSecret': brand2_clientsecret }
    };
    
    // We'll fake a logout request incase the source wants one...
    // We're faking it because it's ridiculous and SFMC doesn't even have a token logout API
    if (destroy) {
        res.cookie('JSESSIONID', 'A7038F5E5EE7C87267A1806EC3B1B3FE.ws06-ri5', { maxAge: new Date(Date.now() + (10*60*1000)), httpOnly: true, secure: false })
            .set('Content-Type', 'text/xml')
            .send(xmlHelper.rebuildXml(body))
            .status(200)
            .end()
            ;  

        return false;
    }

    // Fake our tokens in case the source can't support different credentials by brand...
    if (username && password) {
        let tokenBuffer = Buffer.from(`apigee_${username}:${password}`);
        let permitted = tokenBuffer.toString('base64') === apigee_token;
        let faux_token = permitted ? { 'accessToken': `${apigee_token}` } : { 'accessToken': `${unauthorized}` };

        // Here we'll send a pointless cookie, because when SAP PO is the source it doesn't know what to do without it...
        res.cookie('JSESSIONID', 'A7038F5E5EE7C87267A1806EC3B1B3FE.ws06-ri5', { maxAge: new Date(Date.now() + (10*60*1000)), httpOnly: true, secure: false })
            .set('Content-Type', 'text/xml')
            .send(xmlHelper.rebuildXml(faux_token))
            .status(200)
            .end()
            ;

        return false;
    }

    // If a sessionid is already established, build the post body to send the message,
    // otherwise build the body to request a new access token
    if (sessionid === apigee_token) {
        const auth_endpoint = 'https://auth.exacttargetapis.com/v1/requestToken';
        const send_endpoint = 'https://<sfmc-host>.rest.marketingcloudapis.com/interaction/v1/events';
        const normalizedFieldnames = recorddata.fieldnames.map(item => item.toLowerCase());
        const recipientData = _.zipObject(normalizedFieldnames, recorddata.records.fieldvalues);
        const optionalData = _.isArray(triggerdata.optionaldata)
            ? triggerdata.optionaldata.reduce((map, obj) => (map[obj.name] = obj.value, map), {})
            : triggerdata.optionaldata.value
            ;
        
        let creds = _.get(brand_map, campaign.foldername);
        let { clientId, clientSecret } = creds;
        let auth_payload = {
            'clientId': clientId
            , 'clientSecret': clientSecret
        }

        // Build out the payload depending on which service we're calling, and from which
        // source system, since some differ slightly...
        let send_payload = {
            'contactkey': recipientData.email_address_
            , 'EventDefinitionKey': 'Journey'
            , 'Data': {
                'Emailaddress': recipientData.email_address_
                , ...(recipientData.email_permission_status_ && { 'Permission': recipientData.email_permission_status_ })
                , ...(recipientData.first_name && { 'First_Name': recipientData.first_name })
                , ...(recipientData.last_name && { 'Last_Name': recipientData.last_name })
                , ...(recipientData.lang_locale && { 'Lang_Locale': recipientData.lang_locale })
                , 'Brand_Code': optionalData.BRAND_CODE || recipientData.brand_code
                , 'Optin_Source': 'Email'
                , 'XML__HTML': optionalData.XMLData || optionalData
            }
        }
        // Send the payload to SFMC to get auth token and setup authorization header
        let get_token = axios.post(auth_endpoint, auth_payload).then(response => {
            let axiosConfig = {
                headers: {
                    'Authorization': `Bearer ${response.data.accessToken}`
                }
            }

            // Send the e-receipt
            let journey = axios.post(send_endpoint, send_payload, axiosConfig).then(response => {
                // Transform it to XML schema and return to client
                res.cookie('JSESSIONID', 'A7038F5E5EE7C87267A1806EC3B1B3FE.ws06-ri5', { maxAge: new Date(Date.now() + (10*60*1000)), httpOnly: true, secure: false })
                    .set('Content-Type', 'text/xml')
                    .send(xmlHelper.rebuildXml(response.data))
                    .status(200)
                    .end()
                    ;
            }).catch(error => { console.log(`Well, somethin broke... ${error}`)});            
        }).catch(error => { console.log(`Well, somethin broke... ${error}`) });

        return false;
    }

    // Token doesn't match, send client a faked error response and prevent a call to SFMC
    res.set('Content-Type', 'text/xml')
        .status(500)
        .send(xmlHelper.rebuildXml())
        ;
});

// Setup our app listening on environment setting port or 3000
const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Listening on port ${port}...`));