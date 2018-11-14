"use strict";

const _ = require('underscore');
const similar_text = require('locutus/php/strings/similar_text');

/**
 * utility function to perform approximate string matching.  This is useful in cases like voice integration where the voice recognition may not
 * produce perfect text input, i.e., what the user says may not be perfectly converted into text.  In such case, an approximate matching needs to
 * be performed.
 * @function module:botUtil.approxTextMatch
 * @return {string} The best match if it matches above the similarity threshold provided.
 * @param {string} item - A string to be matched to a list of strings for best approximate matching.
 * @param {string[]} list - An array of strings to be matched with item.
 * @param {boolean} [lowerCase] - if true, the item and list are first converted to lower case before matching.
 * @param {boolean} [removeSpace] - if true, the item and list are first stripped of space before matching.
 * @param {int} similarity - A number between 1 and 10, with higher numer meaning higher similarity.
 */
function approxTextMatch(item, list, lowerCase, removeSpace, similarity) {
    function preProcess(item){
      if (removeSpace){
        item = item.replace(/\s/g, '');
      }
      if (lowerCase) {
        item = item.toLowerCase();
      }
      return item;
    }

    var matched = false;
    var matchedItem = null;
    var itemProcessed = preProcess(item);
    var result = _.map(list, function(listItem) {
        var listItemProcessed = preProcess(listItem);
        if (itemProcessed === listItemProcessed) {
            matchedItem = {
              exactMatch: true,
              item: listItem
            };
            matched = true;
            return matchedItem;
        }
        return {
            exactMatch: false,
            similarity: similar_text(itemProcessed, listItemProcessed),
            item: listItem
        };
    });
    if (!matched) {
        console.log(result);
        matchedItem = _.max(result, function(match) {
            return match.similarity;
        });
        if (matchedItem.similarity > (similarity)) {
            return matchedItem;
        } else {
            return null;
        }
    } else {
      return matchedItem;
    }
}

/**
 * The botUtil is a set of utility functions for bot integration.
 * @module botUtil
 */
module.exports = {
  approxTextMatch: approxTextMatch
};
