const xml2js = require('xml2js');

// Helper function to transform the newly aquired token and API send response 
// back into the native SOAP format
var rebuildXml = function(body) {
    const builder = new xml2js.Builder();
    let obj = {};
    
    if (body) {
        const id = body.accessToken || body.eventInstanceId;
        obj = {
            'soapenv:Envelope': {
                $: {
                    'xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/'
                },
                'soapenv:Body': {
                    ...(body.accessToken && {
                        'loginResponse': {
                            $: {
                                'xmlns': 'urn:ws.rsys.com'
                            },
                            'result': {
                                'sessionId': `${id}`
                            }
                        }
                    }),
                    ...(body.eventInstanceId && {
                        'mergeTriggerEmailResponse': {
                            $: {
                                'xmlns': 'urn:ws.rsys.com'
                            },
                            'result': {
                                'recipientId': `${id}`,
                                'success': 'true',
                                'errorMessage': {
                                    $: {
                                        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                                        'xsi:nil': '1'
                                    }
                                }
                            }
                        }
                    }),
                    ...(body.logout && {
                        'logoutResponse': {
                            $: {
                                'xmlns': 'urn:ws.rsys.com'
                            },
                            'result': 'true'
                        }
                    })
                }
            }
        }
    } else {
        obj = {
            'soapenv:Envelope': {
                $: {
                    'xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/'
                },
                'soapenv:Body': {
                    'soapenv:Fault': {
                        'faultcode': 'soapenv:Server',
                        'faultstring': 'UnexpectedErrorFault',
                        'detail': {
                            'UnexpectedErrorFault': {
                                $: {
                                    'xmlns': 'urn:fault.ws.rsys.com'
                                },
                                'exceptionCode': 'INVALID_SESSION_ID',
                                'exceptionMessage': 'Session not available in the system. Please login.'
                            }
                        }
                    }
                }
            }
        }
    }

    return builder.buildObject(obj);
}

module.exports = { rebuildXml };