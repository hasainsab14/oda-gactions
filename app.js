const express = require('express')
const _ = require("underscore");
const http = require('http')
const favicon = require('serve-favicon');
const logger = require('morgan');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const errorHandler = require('errorhandler');
const Joi = require('joi');
const MessageModel = require('./bots-js-utils/lib/messageModel/MessageModel.js')(Joi);
const messageModelUtil = require('./bots-js-utils/lib/messageModel/messageModelUtil.js');
const botUtil = require('./bots-js-utils/lib/util/botUtil.js');
const webhookUtil = require('./bots-js-utils/lib/webhook/webhookUtil.js');
const PubSub = require('pubsub-js');

module.exports = function() { 
  var self = this;
  var gapp;

  PubSub.immediateExceptions = true;

  process.env.DEBUG = 'actions-on-google:*';

  const ActionsSdkApp = require('actions-on-google').ActionsSdkApp;

  const NO_INPUTS = [
    'I do not hear you for a while.',
    'If you are still there, talk again.',
    'We can finish here. See you soon.'
  ];


    //replace these settings to point to your webhook channel
  var metadata = {
    allowConfigUpdate: true, //set to false to turn off REST endpoint of allowing update of metadata
    waitForMoreResponsesMs: 200,  //milliseconds to wait for additional webhook responses
    channelSecretKey: '<your_channelSecretKey>',
    channelUrl: '<your_channelUrl>'
  };

  this.randomIntInc = function (low, high) {
    return Math.floor(Math.random() * (high - low + 1) + low);
  };

  this.setConfig = function(config) {
    metadata = _.extend(metadata, _.pick(config, _.keys(metadata)));
  }

  // expose this function to be stubbed
  this.sendWebhookMessageToBot= function (channelUrl, channelSecretKey, userId, messagePayload, additionalProperties, callback) {

  console.log('sendWebhookMessageToBot()' +
  ' metadata.channelUrl=' + channelUrl +
  ' metadata.channelSecretKey=' + channelSecretKey +
  ' userId=' + userId +
  ' messagePayload=%j' , messagePayload)

    webhookUtil.messageToBotWithProperties(channelUrl, channelSecretKey, userId, messagePayload, additionalProperties, callback);
  };


  this.init= function (config) {

    var app = express();

    // all environments
    app.use(methodOverride());

    app.use(bodyParser.json());
    // var gactionRouter = express.Router();
    // gactionRouter = app.use(bodyParser.json());
    // app.use('/', gactionRouter);
    //app.use(bodyParser.urlencoded({ extended: true }));

    // app.use(favicon(__dirname + '/public/favicon.ico'));
    // app.use(express.static(path.join(__dirname, 'public')));

    // development only
    if ('development' == app.get('env')) {
      app.use(errorHandler());
    }

    var logger = (config ? config.logger : null);
    if (!logger) {
      logger = console;
    }

    if (metadata.channelUrl && metadata.channelSecretKey) {
      logger.info('Google Assistant singleBot - Using Channel:', metadata.channelUrl);
    }

    // compile the list of actions, global actions and other menu options
    function menuResponseMap (resp, card) {
      var responseMap = {};

      function addToMap (label, type, action) {
        responseMap[label] = {type: type, action: action};
      }

      if (!card) {
        if (resp.globalActions && resp.globalActions.length > 0) {
          resp.globalActions.forEach(function (gAction) {
            addToMap(gAction.label, 'global', gAction);
          });
        }
        if (resp.actions && resp.actions.length > 0) {
          resp.actions.forEach(function (action) {
            addToMap(action.label, 'message', action);
          });
        }
        if (resp.type === 'card' && resp.cards && resp.cards.length > 0) {
          resp.cards.forEach(function (card) {
            //special menu option to navigate to card detail
            addToMap('Card ' + card.title, 'card', {type: 'custom', value: {type: 'card', value: card}});
          });
        }
      } else {
        if (card.actions && card.actions.length > 0) {
          card.actions.forEach(function (action) {
            addToMap(action.label, 'message', action);
          });
        }
        //special menu option to return to main message from the card
        addToMap('Return', 'cardReturn', {type: 'custom', value: {type: 'messagePayload', value: resp}});
      }
      return responseMap;
    }

    if (metadata.allowConfigUpdate) {
      app.put('/config', bodyParser.json(), function(req, res){
        let config = req.body;
        logger.info(config);
        if (config) {
          self.setConfig(config);
        }
        res.sendStatus(200).send();
      });
    }


    // =====================================================
    // callback da IBCS
    // =====================================================

    app.post('/gActionsBotWebhook/messages', bodyParser.json({
      verify: webhookUtil.bodyParserRawMessageVerify
    }), function (req, res) {
      logger.info('==> /gActionsBotWebhook')
      logger.info('req.body=%j', req.body)

      const userID = req.body.userId;
      if (!userID) {
        logger.error('Missing User ID')
        return res.status(400).send('Missing User ID');
      }
            logger.info('req.rawBody=%j', req.rawBody)

      if (webhookUtil.verifyMessageFromBot(req.get('X-Hub-Signature'), req.rawBody, req.encoding, metadata.channelSecretKey)) {
        logger.info("Publishing to", userID);
        res.sendStatus(200);
        PubSub.publish(userID, req.body);
      } else {
        logger.info("Error 403");
        res.sendStatus(403);
      }
    });


    // =====================================================
    // callback da GActions
    // =====================================================

    var session = []

    // google action setup
    app.post('/', function (request, response) {

      console.log("===> /")
      gapp = new ActionsSdkApp({request, response});

      const conversationId = gapp.getConversationId();

      logger.info('Conversation Id: ' + conversationId)
      logger.info('Session : %j' , session[conversationId])

      if (session[conversationId] === undefined) {

        session[conversationId] = {
          userId : self.randomIntInc(1000000, 9999999).toString(),
          botMessages: [],
          botMenuResponseMap: {}
        }
      }

      logger.info('User Id: ' + session[conversationId].userId)

      function mainIntent (gapp) {
        console.log('Start session with Google Assistant. Im calling mainIntent()');
        let inputPrompt = gapp.buildInputPrompt(true, '<speak>Hello!! <break time="1"/> ' +
          'Welcome to the Oracle digital assistance, how may i help you?</speak>', NO_INPUTS);
        gapp.ask(inputPrompt);
      }

      function rawInput (gapp) {
        console.log('received text from Google Assistant rawInput()');
        
        // se l'input e' fine usa il metodo tell() che risponde e chiude la connessione 
        if (gapp.getRawInput().toLowerCase() === 'fine') {
          gapp.tell('See you next time!');
        }
        else {
          // LUCA - NON RISPONDI DIRETTAMENTE
          // let inputPrompt = gapp.buildInputPrompt(true, '<speak>Hai detto, ' + gapp.getRawInput() + '.</speak>', NO_INPUTS);
          // gapp.ask(inputPrompt);

          var command = gapp.getRawInput()

          if (metadata.channelUrl && metadata.channelSecretKey && session[conversationId].userId && command) {

            const userIdTopic = session[conversationId].userId;
            var respondedToGActions = false;
            var additionalProperties = {
              "profile": {
                "clientType": "alexa"
              }
            };

            // defisce la funzione per rispondere a Google Assistant

            var sendToGActions = function (resolve, reject) {
              console.log ('sendToGActions() resolve=', resolve)
              if (!respondedToGActions) {
                respondedToGActions = true;
                logger.info('Prepare to send to GActions');
                resolve();
                PubSub.unsubscribe(userIdTopic);
              } else {
                logger.info("Already sent response");
              }
            } // sendToGActions

            // compose text response to gactions, and also save botMessages and botMenuResponseMap to gactions session so they can be used to control menu responses next
            var navigableResponseToGActions = function (resp) {
              var respModel;
              if (resp.messagePayload) {
                respModel = new MessageModel(resp.messagePayload);
              }
              else {
                // handle 1.0 webhook format as well
                respModel = new MessageModel(resp);
              }
              var botMessages = session[conversationId].botMessages;
              if (!Array.isArray(botMessages)) {
                botMessages = [];
              }
              var botMenuResponseMap = session[conversationId].botMenuResponseMap;
              if (typeof botMenuResponseMap !== 'object') {
                botMenuResponseMap = {};
              }
              botMessages.push(respModel.messagePayload());
              session[conversationId].botMessages =  botMessages;
              session[conversationId].botMenuResponseMap = Object.assign(botMenuResponseMap || {}, menuResponseMap(respModel.messagePayload()));
              let messageToGActions = messageModelUtil.convertRespToText(respModel.messagePayload());
              logger.info("Message to GAtions (navigable):", messageToGActions)

              // LUCA API GOOGLE
              // LUCA: Qui si potrebbe aggiungere un controllo per fare in modo che
              // ad una speciale stringa da IBCS (es. sessionechiuse) si risponda con tell() invece che con ask()
              
              let inputPrompt = gapp.buildInputPrompt(true, '<speak>' + messageToGActions + '.</speak>', NO_INPUTS);
              gapp.ask(inputPrompt);
            
            } // - navigableResponseToGActions()

            // defisce la funzione sendMessageToBot()

            var sendMessageToBot = function (messagePayload) {

              logger.info('sendMessageToBot() Creating new promise for', messagePayload);

              return new Promise(function(resolve, reject) {

                // definisce la funzione chiamata da PubSub a seguito della subscribe()
                // che viene eseguita quando si riceve un messaggio da IBCS
                var commandResponse = function (msg, data) {
                  logger.info('commandResponse() Received callback message from webhook channel');
                  var resp = data;
                  logger.info('Parsed Message Body:', resp);
                  if (!respondedToGActions) {
                    navigableResponseToGActions(resp);
                  }
                  else {
                    logger.info("Already processed response");
                    return;
                  }
                  if (metadata.waitForMoreResponsesMs) {
                    _.delay(function () {
                      sendToGActions(resolve, reject);
                    }, metadata.waitForMoreResponsesMs);
                  } else {
                    sendToGActions(resolve, reject);
                  }
                };

                // si sottoscrive per messaggi dedicati allo specifico utente

                var token = PubSub.subscribe(userIdTopic, commandResponse);

                // invia il messaggio ad IBCS
                self.sendWebhookMessageToBot(metadata.channelUrl, metadata.channelSecretKey, userIdTopic, messagePayload, additionalProperties, function (err) {
                  if (err) {
                    logger.info("Failed sending message to Bot");
                    let inputPrompt = gapp.buildInputPrompt(true, '<speak>Failed sending message to Bot.  Please review your bot configuration.</speak>', NO_INPUTS);
                    gapp.ask(inputPrompt);
                    reject();
                    PubSub.unsubscribe(userIdTopic);
                  }
                });

              });

            } // sendMessageToBot()


            var handleInput = function (input) {
              logger.info('handleInput() input=', input)
              var botMenuResponseMap = session[conversationId].botMenuResponseMap;
              if (typeof botMenuResponseMap !== 'object') {
                botMenuResponseMap = {};
              }
              var menuResponse = botUtil.approxTextMatch(input, _.keys(botMenuResponseMap), true, true, 7);
              var botMessages = session[conversationId].botMessages;
              //if command is a menu action
              if (menuResponse) {
                var menu = botMenuResponseMap[menuResponse.item];
                // if it is global action or message level action

                if (['global', 'message'].includes(menu.type)) {
                  var action = menu.action;
                  session[conversationId].botMessages = [];
                  session[conversationId].botMenuResponseMap = {};
                  if (action.type === 'postback') {
                    var postbackMsg = MessageModel.postbackConversationMessage(action.postback);
                    return sendMessageToBot(postbackMsg);
                  }
                  else if (action.type === 'location') {
                    logger.info('Sending a predefined location to bot');
                    return sendMessageToBot(MessageModel.locationConversationMessage(37.2900055, -121.906558));
                  }
                  // if it is navigating to card detail
                }
                else if (menu.type === 'card') {
                  var selectedCard;
                  if (menu.action && menu.action.type && menu.action.type === 'custom' && menu.action.value && menu.action.value.type === 'card') {
                    selectedCard = _.clone(menu.action.value.value);
                  }
                  if (selectedCard) {
                    if (!Array.isArray(botMessages)) {
                      botMessages = [];
                    }
                    var selectedMessage;
                    if (botMessages.length === 1) {
                      selectedMessage = botMessages[0];
                    } else {
                      selectedMessage = _.find(botMessages, function (botMessage) {
                        if (botMessage.type === 'card') {
                          return _.some(botMessage.cards, function (card) {
                            return (card.title === selectedCard.title);
                          });
                        } else {
                          return false;
                        }
                      });
                    }
                    if (selectedMessage) {
                      //session.set("botMessages", [selectedMessage]);
                        session[conversationId].botMenuResponseMap = menuResponseMap(selectedMessage, selectedCard);
                        let messageToGActions = messageModelUtil.cardToText(selectedCard, 'Card');
                        logger.info("Message to GActions (card):", messageToGActions)
                        gapp.ask(messageToGActions);
                        return;
                    }
                  }
                  // if it is navigating back from card detail
                }
                else if (menu.type === 'cardReturn') {
                  var returnMessage;
                  if (menu.action && menu.action.type && menu.action.type === 'custom' && menu.action.value && menu.action.value.type === 'messagePayload') {
                    returnMessage = _.clone(menu.action.value.value);
                  }
                  if (returnMessage) {
                    //session.set("botMessages", [returnMessage]);
                    session[conversationId].botMenuResponseMap = _.reduce(botMessages, function(memo, msg){
                        return Object.assign(memo,menuResponseMap(msg));
                      }, {});
                      //session.set("botMenuResponseMap", menuResponseMap(returnMessage));
                      _.each(botMessages, function(msg){
                        let messageToGActions = messageModelUtil.convertRespToText(msg);
                        logger.info("Message to GActions (return from card):", messageToGActions);
                        gapp.ask(messageToGActions);
                      })
                      return;
                  }
                }
              }
              else {

                var commandMsg = MessageModel.textConversationMessage(command);
                return sendMessageToBot(commandMsg);
              }
            } // handleInput()

            return handleInput(command);
          }
          else {
            _.defer(function () {
              logger.error("LUCA : I don't understand. Could you please repeat what you want?");
              //alexa_res.send();
            });
          }


      }
    }


      let actionMap = new Map(); 
      actionMap.set(gapp.StandardIntents.MAIN, mainIntent);
      actionMap.set(gapp.StandardIntents.TEXT, rawInput);

      gapp.handleRequest(actionMap);
    });

    app.locals.endpoints = [];
    app.locals.endpoints.push({
      name: 'webhook',
      method: 'POST',
      endpoint: '/gActionsBotWebhook/messages'
    });
    app.locals.endpoints.push({
      name: 'gaction',
      method: 'POST',
      endpoint: '/'
    });

    return app;

  } // init

  return this;

}()
