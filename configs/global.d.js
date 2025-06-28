/**
 * @typedef {Object} OnBoardingSlide
 * @property {string} color
 * @property {any} image
 * @property {string} title
 * @property {string} secondTitle
 * @property {string} subTitle
 */

/**
 * @typedef {Object} ReviewsType
 * @property {string} id
 * @property {UserType} user
 * @property {string} userId
 * @property {string} courseId
 * @property {number} rating
 * @property {any[]} replies
 * @property {string} comment
 * @property {any} createdAt
 * @property {any} updatedAt
 */

/**
 * @typedef {Object} OrderType
 * @property {string} id
 * @property {string} userId
 * @property {string|null} payment_info
 * @property {string} courseId
 * @property {any} createdAt
 * @property {any} updatedAt
 */

/**
 * @typedef {Object} NotificationType
 * @property {string} id
 * @property {string} title
 * @property {string} message
 * @property {string} status
 * @property {UserType=} user
 * @property {string} creatorId
 * @property {string|null} receiverId
 * @property {string|null} redirect_link
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} TicketReplies
 * @property {string} id
 * @property {string} ticketId
 * @property {string} reply
 * @property {UserType} user
 * @property {string} replyId
 * @property {Date|null} createdAt
 * @property {Date|null} updatedAt
 */

/**
 * @typedef {Object} TicketsTypes
 * @property {string} id
 * @property {string} creatorId
 * @property {string} ticketTitle
 * @property {TicketReplies[]} reply
 * @property {string} details
 * @property {string} status
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} UserType
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string} password
 * @property {string} phone_number
 * @property {string} avatar
 * @property {string} stripeCustomerId
 * @property {string} githubUserName
 * @property {string} role
 * @property {string=} pushToken
 * @property {boolean} verified
 * @property {ReviewsType[]} reviews
 * @property {OrderType[]} orders
 * @property {ReviewsType[]} reviewsReplies
 * @property {NotificationType[]} Notification
 * @property {TicketsTypes[]} Tickets
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} AnswerType
 * @property {string} id
 * @property {string} userId
 * @property {string} questionId
 * @property {string} answer
 * @property {UserType} user
 * @property {string=} image
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} QuestionType
 * @property {string} id
 * @property {string} userId
 * @property {UserType} user
 * @property {string} contentId
 * @property {string} question
 * @property {string=} image
 * @property {AnswerType[]} answers
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} BenefitsType
 * @property {string} id
 * @property {string} title
 * @property {string} courseId
 * @property {any} createdAt
 * @property {any} updatedAt
 */

/**
 * @typedef {Object} CourseDataType
 * @property {string} id
 * @property {string} title
 * @property {string} videoUrl
 * @property {string=} conversationId
 * @property {string} videoSection
 * @property {QuestionType[]} questions
 * @property {string} description
 * @property {string} videoLength
 * @property {any} links
 * @property {string|null} videoPlayer
 * @property {string} courseId
 */

/**
 * @typedef {Object} CourseType
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string|null} categories
 * @property {number} price
 * @property {number|null} estimatedPrice
 * @property {string} thumbnail
 * @property {string} tags
 * @property {string} level
 * @property {string} demoUrl
 * @property {string} slug
 * @property {number} lessons
 * @property {string|null} payment_id
 * @property {number} ratings
 * @property {number} purchased
 * @property {string=} iosProductId
 * @property {string=} androidProductId
 * @property {BenefitsType[]} benefits
 * @property {BenefitsType[]} prerequisites
 * @property {CourseDataType[]} courseData
 * @property {ReviewsType[]} reviews
 * @property {OrderType[]} orders
 * @property {any} createdAt
 * @property {any} updatedAt
 */
