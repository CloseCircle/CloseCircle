if (Meteor.isClient) {
  // This code only runs on the client
  Template.body.helpers({
    topics: [
      { title: "This is topic 1" },
      { title: "This is topic 2" },
      { title: "This is topic 3" }
    ]
  });
}