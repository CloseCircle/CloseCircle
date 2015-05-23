// simple-todos.js
Topics = new Mongo.Collection("topics");

if (Meteor.isClient) {
  Template.body.events({
    "submit .new-topic": function (event) {
      // This function is called when the new task form is submitted

      var title = event.target.title.value;

      Topics.insert({
        title: title,
        createdAt: new Date() // current time
      });

      // Clear form
      event.target.title.value = "";

      // Prevent default form submit
      return false;
    }
  });

  // This code only runs on the client
  Template.body.helpers({
    topics: function () {
      return Topics.find({}, {sort: {createdAt: -1}});
    }
  });

  Template.topic.events({
    "click .toggle-checked": function () {
      // Set the checked property to the opposite of its current value
      Topics.update(this._id, {$set: {checked: ! this.checked}});
    },
    "click .delete": function () {
      Topics.remove(this._id);
    }
  });

  Accounts.ui.config({
    passwordSignupFields: "USERNAME_ONLY"
  });
}