const demoPages = [
  `Foundations of Artificial Intelligence\n\nArtificial intelligence is the study of systems that perceive their environment and take actions to achieve goals. Intelligent agents combine perception, reasoning, and learning.\n\nMachine learning is a subset of AI. It enables systems to learn patterns from data rather than relying on explicitly programmed rules. Supervised learning uses labeled examples; unsupervised learning discovers structure in unlabeled data. Reinforcement learning uses rewards to guide decisions.`,
  `Search and Problem Solving\n\nA search problem consists of an initial state, a set of actions, a transition model, a goal test, and a path cost. Breadth-first search explores the shallowest nodes first. Depth-first search explores the deepest nodes first.\n\nA* search evaluates nodes using f(n) = g(n) + h(n). Here g(n) is the cost so far and h(n) is the estimated remaining cost. An admissible heuristic never overestimates the true remaining cost.`,
  `Neural Networks\n\nA neural network consists of connected layers of artificial neurons. Each neuron applies weights to its inputs and passes the result through an activation function.\n\nBackpropagation computes gradients of the loss with respect to the weights using the chain rule. Gradient descent updates the weights in the direction that reduces the loss. Overfitting occurs when a model learns training-specific patterns that do not generalize. Regularization and validation help address overfitting.`,
];
export const samples = [
  {
    id: "ai",
    name: "Artificial Intelligence",
    file: "AI — Fundamentals.pdf",
    category: "Computer science",
    pages: demoPages,
    progress: 35,
    kind: "Course notes",
    sample: true,
  },
  {
    id: "db",
    name: "Database Management",
    file: "DBMS — Core concepts.pdf",
    category: "Computer science",
    pages: [
      "Relational Databases\n\nA relational database organizes data into tables. A primary key uniquely identifies a row. A foreign key refers to a key in another table. Normalization reduces redundancy and update anomalies.",
      "Transactions\n\nACID stands for atomicity, consistency, isolation, and durability. Atomicity makes a transaction all-or-nothing. Isolation controls how concurrent transactions interact.",
    ],
    progress: 0,
    kind: "Study guide",
    sample: true,
  },
  {
    id: "ml",
    name: "Machine Learning",
    file: "ML — Revision notes.pdf",
    category: "Computer science",
    pages: [
      "Machine Learning\n\nSupervised learning trains on labeled data. Classification predicts discrete labels; regression predicts continuous values.",
      "Model Evaluation\n\nA held-out test set estimates generalization. Precision is the fraction of positive predictions that are correct. Recall is the fraction of actual positives that are found.",
    ],
    progress: 0,
    kind: "Revision notes",
    sample: true,
  },
];
