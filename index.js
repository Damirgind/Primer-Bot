// Импорт библиотек
require('dotenv').config()
const {
	Bot,
	GrammyError,
	HttpError,
	Keyboard,
	InlineKeyboard,
} = require('grammy')
const fetch = require('node-fetch')
const axios = require('axios')
const express = require('express')
const https = require('https')
const fs = require('fs')
const app = express()

// Создание бота
const bot = new Bot(process.env.BOT_API_KEY)
exports.bot = bot

// Получение значений из переменных окружения
const privateKey = process.env.PRIVATE_KEY
const certificate = process.env.CERTIFICATE

const credentials = { key: privateKey, cert: certificate }

// Создание HTTPS сервера
const httpsServer = https.createServer(credentials, app)

// Настройка вашего бота
app.post('/' + bot.token, (req, res) => {
	bot.handleUpdate(req.body, res)
})

let PERSONDATA = {
	id: null,
	firstName: null,
	lastName: null,
	fullName: null,
	username: null,
	payName: null,
	phone: null,
	location: null,
	mail: null,
	order: [],
	paymentOrder: [],
	dataOrder: null,
}

let DATARECORDS = {}

// ------------
// Установка командhttps. для бота
bot.api.setMyCommands([
	{
		command: 'start',
		description: 'Запустить бота',
	},
	{
		command: 'questions',
		description: 'Вопросы',
	},
	{
		command: 'new_buy',
		description: 'Новая покупка',
	},
])
// ------------

// КОМАНДЫ
bot.command('start', async ctx => await STARTCommand(ctx))
bot.command('questions', async ctx => await QUESTIONSComand(ctx))
bot.command('new_buy', async ctx => await NEWBUYCommand(ctx))

// ---------------------------------------------------------------------
// ПРОГРАММА БОТА

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000 // 5 минут

function keepBotAlive() {
	setInterval(async () => {
		try {
			await axios.get(
				`https://api.telegram.org/bot${process.env.BOT_API_KEY}/getUpdates`
			)
			console.log('Бот активен')
		} catch (error) {
			console.error('Ошибка при попытке сохранить бота активным:', error)
		}
	}, KEEP_ALIVE_INTERVAL)
}

// Запустите функцию в вашем основном коде
keepBotAlive()

moodHears(bot)
questionsHears(bot)

// ОТПРАВКА ПЕРВИЧНЫХ ДАННЫХ В БАЗУ ДАННЫХ
async function sendDataToBase(ctx) {
	const response = await fetch(
		`https://api.airtable.com/v0/${process.env.BASE_ORDERS_ID}/${process.env.BASE_ORDERS_TABLE_NAME}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.BASE_API_ORDERS_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				fields: {
					UserID: PERSONDATA.id,
					FirstName: PERSONDATA.firstName,
					LastName: PERSONDATA.lastName,
					FullName: PERSONDATA.fullName,
					UserName: PERSONDATA.username,
					OrderStatus: 'Started',
				},
			}),
		}
	)

	const data = await response.json()
	if (response.ok) {
		console.log(
			'Предварительное сохранение данных пользователя произошло успешно'
		)
	} else {
		console.error(
			'Предварительное сохранение данных пользователя не произошло. Error creating record:',
			data
		)
	}
}

// ОТПРАВКА ДАННЫХ ПОСЛЕ ОПЛАТЫ В БАЗУ ДАННЫХ
async function sendFinalDataToBase(ctx) {
	const response = await fetch(
		`https://api.airtable.com/v0/${process.env.BASE_ORDERS_ID}/${process.env.BASE_ORDERS_TABLE_NAME}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.BASE_API_ORDERS_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				fields: {
					UserID: PERSONDATA.id,
					FirstName: PERSONDATA.firstName,
					LastName: PERSONDATA.lastName,
					FullName: PERSONDATA.fullName,
					UserName: PERSONDATA.username,
					PayName: PERSONDATA.payName,
					Phone: PERSONDATA.phone,
					Mail: PERSONDATA.mail,
					Location: PERSONDATA.location,
					Order: PERSONDATA.dataOrder,
					Payment: ctx.message.successful_payment.total_amount / 100,
					OrderStatus: 'Paid',
				},
			}),
		}
	)

	const data = await response.json()
	if (response.ok) {
		console.log('Данные после оплаты успешно сохранены.')
	} else {
		console.error(
			'Ошибка при сохранении данных после оплаты. Error creating record:',
			data
		)
	}
}

// СБОР АДМИН ДАННЫХ ДЛЯ БОТА
async function fetchDataFromBase(ctx) {
	DATARECORDS = {}

	try {
		const response = await fetch(
			`https://api.airtable.com/v0/${process.env.BASE_ADMIN_ID}/${process.env.BASE_ADMIN_TABLE_NAME}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${process.env.BASE_API_ORDERS_TOKEN}`,
					'Content-Type': 'application/json',
				},
			}
		)

		const data = await response.json()

		if (response.ok) {
			// Подсчет суммы всех значений в колонке Summ
			const summValues = data.records
				.map(record => record.fields.Summ || 0) // Получаем значения Summ или 0, если оно не существует
				.reduce((acc, curr) => acc + curr, 0) // Суммируем

			// Проверка, положительная ли сумма
			if (summValues > 0) {
				DATARECORDS = {
					GeneralMedia: {
						general: [],
						categories: {},
					},
					Products: {},
				}

				data.records.forEach(record => {
					const fields = record.fields

					const { Titles, Price, Color, Photo, Shirts, Hoodies, General } =
						fields

					// Сбор всех медиа из колонки General
					if (General && Array.isArray(General)) {
						General.forEach(info => {
							DATARECORDS.GeneralMedia.general.push({
								type: 'photo', // Устанавливаем тип на photo
								media: info.thumbnails?.full?.url || '', // Берем полную ссылку
							})
						})
					}

					// Создание структуры продукта (Hoodie или Shirt)
					const productType = Titles.includes('Худи') ? 'Hoodie' : 'Shirt'
					if (!DATARECORDS.Products[productType]) {
						DATARECORDS.Products[productType] = {
							title: Titles,
							price: Price,
							color: {},
						}
					}

					// Обработка цвета
					if (!DATARECORDS.Products[productType].color[Color]) {
						DATARECORDS.Products[productType].color[Color] = {
							title: Color,
							size: {
								L: fields.L || 0, // Используем значения из полей
								M: fields.M || 0,
								S: fields.S || 0,
							},
							media: [],
						}
					}

					// Добавление медиа по цвету из колонки Photo
					if (Photo && Array.isArray(Photo)) {
						Photo.forEach(photo => {
							DATARECORDS.Products[productType].color[Color].media.push({
								type: 'photo', // Изменяем тип на photo
								media: photo.thumbnails?.full?.url || '', // Берем полную ссылку
							})
						})
					}

					// Добавление медиа из колонок Hoodies и Shirts в GeneralMedia.categories
					if (Hoodies && Array.isArray(Hoodies)) {
						if (!DATARECORDS.GeneralMedia.categories.Hoodie) {
							DATARECORDS.GeneralMedia.categories.Hoodie = []
						}
						Hoodies.forEach(hoodie => {
							DATARECORDS.GeneralMedia.categories.Hoodie.push({
								type: 'photo',
								media: hoodie.thumbnails?.full?.url || '', // Берем полную ссылку
							})
						})
					}

					if (Shirts && Array.isArray(Shirts)) {
						if (!DATARECORDS.GeneralMedia.categories.Shirt) {
							DATARECORDS.GeneralMedia.categories.Shirt = []
						}
						Shirts.forEach(shirt => {
							DATARECORDS.GeneralMedia.categories.Shirt.push({
								type: 'photo',
								media: shirt.thumbnails?.full?.url || '', // Берем полную ссылку
							})
						})
					}
				})
			} else {
				console.error('На складе нет товаров')
				await ctx.reply(
					'Извните, но вся одежда распродана. Мы Вам сообщим о новом поступлении...'
				)
				return // Останавливаем дальнейшее выполнение функций
			}
		} else {
			console.error('Ошибка получения данных:', data)
			await ctx.reply(
				'Ошибка при получении данных из базы. Пожалуйста, попробуйте позже.'
			)
		}
	} catch (error) {
		console.error('Ошибка при загрузке данных из Airtable:', error)
		await ctx.reply('Не удалось получить данные из Airtable.')
	}
}

function getUserData(ctx) {
	const user = ctx.from // Получаем информацию о пользователе
	PERSONDATA.id = ctx.from.id
	PERSONDATA.firstName = user.first_name
	PERSONDATA.lastName = user.last_name ? user.last_name : ''
	PERSONDATA.fullName = PERSONDATA.firstName + ' ' + PERSONDATA.lastName
	PERSONDATA.username = user.username
		? `https://t.me/${user.username}`
		: 'Не указан'
}

// --------------------------------------------------------------------
// ----------START-----------------------------------------------------
// ---------------------------------------------------------------------
async function STARTCommand(ctx) {
	getUserData(ctx)
	sendDataToBase(ctx)

	const moodKeyboard = new Keyboard()
		.text('1')
		.row()
		.text('2')
		.row()
		.text('3')
		.row()
		.text('4')
		.row()
		.resized()
	await ctx.reply(`Привет, ${PERSONDATA.firstName}`)
	await ctx.reply(`Что может делать бот:
		- Помогу подобрать нужный товар
		- Помогу оформить заказ
		- Буду оповещать о продвижении разработки товара
		- Помогу быть в курсе всех новинок, акций, коллекций
		- Буду дарить подарочки`)
	await ctx.reply('Как настроение?', {
		reply_markup: moodKeyboard,
	})
}

// ------------------------------------------------------------------

// -----------------------------------------------------------------

function moodHears(bot) {
	const goFromStartKeyboard = new InlineKeyboard()
		.text('Вопросы', 'toQuestions')
		.text('Погнали!', 'toNewBuy')
	async function REPLY(ctx, react, reply) {
		await ctx.react(react)
		await ctx.reply(reply, {
			reply_parameters: { message_id: ctx.msg.message_id },
			reply_markup: { remove_keyboard: true },
		})
		await ctx.reply(
			`Как все будет происходить:
		- Предложу выбрать товар (платье, свитшот мужской или женский)
		- Помогу выбрать нужный размер
		- Предложу выбрать нужный цвет
		- Помогу оформить заказ
		- Предложу удобные варианты оплаты
		- Пришлю чек об успешной оплате
		- Буду уведомлять о фазах создания заказа`,
			{
				reply_markup: goFromStartKeyboard,
			}
		)
	}

	bot.hears('1', async ctx => await REPLY(ctx, '😭', 'как так-то?'))
	bot.hears('2', async ctx => await REPLY(ctx, '👾', 'я за тебя переживаю...'))
	bot.hears('3', async ctx => await REPLY(ctx, '🌚', 'нормально - это хорошо'))
	bot.hears('4', async ctx => await REPLY(ctx, '😍', 'да вообще круть!'))

	bot.callbackQuery('toNewBuy', async ctx => {
		await ctx.answerCallbackQuery('Погнали покупать!')
		await ctx.reply('👍')
		await NEWBUYCommand(ctx)
	})

	bot.callbackQuery('toQuestions', async ctx => {
		await ctx.answerCallbackQuery('Вопросы')
		await QUESTIONSComand(ctx)
	})
}

// --------------------------------------------------------------------
// ----------QUESTIONS--------------------------------------------------
// ---------------------------------------------------------------------
async function QUESTIONSComand(ctx) {
	const questionsKeyboard = new InlineKeyboard()
		.text('Почему мы можем вам доверять?', 'question1')
		.row()
		.text('Сколько будет длиться разработка?', 'question2')
		.row()
		.text('Сколько все будет стоить?', 'question3')
		.row()
		.text('Что насчет качества?', 'question4')
		.row()
		.text(
			'Какой смысл покупать одежду у вас, есть можно найти дешевле в обычном магазине?',
			'question5'
		)
		.row()
		.text('Как оплатить заказ?', 'question6')
		.row()
		.text('Когда придет заказ?', 'question7')
		.row()
		.text('Подойдет ли мне эта одежда?', 'question8')
		.row()
		.text('Что делать, если мне не понравится одежда?', 'question9')
		.row()
		.text('Какой смысл в христианской одежде?', 'question10')
		.row()
		.text('Почему так дорого?', 'question11')
		.row()
		.text('Можно ли скидку?', 'question12')
		.row()
		.text('В чем смысл бренда "Альфа и Омега"?', 'question13')
		.row()
		.text('У меня другой вопрос (задать лично)', 'question14')
		.row()

	await ctx.reply(
		`В чем вопрос?
Можете посмотреть ответы на распространенные вопросы:`,
		{
			reply_markup: questionsKeyboard,
		}
	)
}

function questionsHears(bot) {
	const goFromQuestionsKeyboard = new InlineKeyboard().text(
		'Продолжить',
		'next'
	)

	async function ANSWER(ctx, answer) {
		await ctx.answerCallbackQuery('Вопрос получен')
		await ctx.reply(answer, {
			reply_markup: goFromQuestionsKeyboard,
		})
	}

	bot.callbackQuery('question1', async ctx => await ANSWER(ctx, 'Ответ1'))
	bot.callbackQuery('question2', async ctx => await ANSWER(ctx, 'Ответ2'))
	bot.callbackQuery('question3', async ctx => await ANSWER(ctx, 'Ответ3'))
	bot.callbackQuery('question4', async ctx => await ANSWER(ctx, 'Ответ4'))
	bot.callbackQuery('question5', async ctx => await ANSWER(ctx, 'Ответ5'))
	bot.callbackQuery('question6', async ctx => await ANSWER(ctx, 'Ответ6'))
	bot.callbackQuery('question7', async ctx => await ANSWER(ctx, 'Ответ7'))
	bot.callbackQuery('question8', async ctx => await ANSWER(ctx, 'Ответ8'))
	bot.callbackQuery('question9', async ctx => await ANSWER(ctx, 'Ответ9'))
	bot.callbackQuery('question10', async ctx => await ANSWER(ctx, 'Ответ10'))
	bot.callbackQuery('question11', async ctx => await ANSWER(ctx, 'Ответ11'))
	bot.callbackQuery('question12', async ctx => await ANSWER(ctx, 'Ответ12'))
	bot.callbackQuery('question13', async ctx => await ANSWER(ctx, 'Ответ13'))
	bot.callbackQuery('question14', async ctx => await ANSWER(ctx, 'Ответ14'))

	bot.callbackQuery('next', async ctx => {
		await ctx.answerCallbackQuery('Погнали!')
		await ctx.reply('😄')
		await NEWBUYCommand(ctx)
	})
}

// --------------------------------------------------------------------
// -----------NEW BUY--------------------------------------------------
// ---------------------------------------------------------------------
// Инициализация корзины и пользовательских данных
let cart = {}
let userSelections = {}

// Функция для создания клавиатуры категорий
function createCategoryKeyboard() {
	const keyboard = new InlineKeyboard()
	for (const category in DATARECORDS.Products) {
		keyboard.text(DATARECORDS.Products[category].title, `category:${category}`)
	}
	return keyboard
}

// Функция для создания клавиатуры цветов
function createColorKeyboard(category) {
	const keyboard = new InlineKeyboard()
	const colors = DATARECORDS.Products[category].color
	for (const color in colors) {
		keyboard.text(colors[color].title, `color:${color}`)
	}
	keyboard.text('Назад', 'back:category')
	return keyboard
}

// Функция для создания клавиатуры размеров
function createSizeKeyboard(category, color) {
	const keyboard = new InlineKeyboard()
	const sizes = DATARECORDS.Products[category].color[color].size
	for (const size in sizes) {
		keyboard.text(`${size} ${sizes[size]}шт.`, `size:${size}`)
	}
	keyboard.text('Назад', 'back:color')
	return keyboard
}

// Функция создания клавиатуры для выбора количества
function createQuantityKeyboard(currentQuantity = 1, maxQuantity = 1) {
	const keyboard = new InlineKeyboard()
	keyboard
		.text('-', 'quantity:minus')
		.text(currentQuantity.toString(), 'quantity:current') // Отображаем текущее количество
		.text('+', 'quantity:plus')
		.row()
	keyboard.text('Назад', 'back:size') // Удаляем кнопку "Оформить", оставляем только "Назад"
	return keyboard
}

// Обработка команды /new_buy
async function NEWBUYCommand(ctx) {
	await ctx.reply(
		'Краткое описание коллекции, философия, цель, смысл А это [ссылочка](https://www.youtube.com/watch?v=q-AFR0D7Vuw) на видео коллекции',
		{
			parse_mode: 'MarkdownV2',
		}
	)
	await fetchDataFromBase(ctx)
	if (JSON.stringify(DATARECORDS) === '{}') {
		console.log('Отклонение функции...')
	} else {
		const keyboard = createCategoryKeyboard()
		if (DATARECORDS.GeneralMedia.general.length) {
			await ctx.replyWithMediaGroup(DATARECORDS.GeneralMedia.general)
		}
		await ctx.reply('Выберите категорию товара:', { reply_markup: keyboard })
	}
}

// Обработка выбора категории
bot.callbackQuery(/^category:(.+)$/, async ctx => {
	await ctx.answerCallbackQuery('Категория. Ответ записывается...')
	const category = ctx.match[1]
	const userId = ctx.from.id
	userSelections[userId] = { category }
	const keyboard = createColorKeyboard(category)
	if (DATARECORDS.GeneralMedia.categories[category]?.length) {
		await ctx.replyWithMediaGroup(DATARECORDS.GeneralMedia.categories[category])
	}
	await ctx.reply('Выберите цвет товара:', { reply_markup: keyboard })
})

// Обработка выбора цвета
bot.callbackQuery(/^color:(.+)$/, async ctx => {
	await ctx.answerCallbackQuery('Цвет. Ответ записывается...')
	const color = ctx.match[1]
	const userId = ctx.from.id
	const category = userSelections[userId].category
	userSelections[userId].color = color
	const mediaArray = DATARECORDS.Products[category].color[color]?.media

	// Проверка на наличие медиа
	if (mediaArray && mediaArray.length > 0) {
		await ctx.replyWithMediaGroup(mediaArray)
	} else {
		await ctx.reply('Изображения для выбранного товара временно недоступны.')
	}

	const keyboard = createSizeKeyboard(category, color)
	await ctx.reply('Выберите размер товара:', { reply_markup: keyboard })
})

// Обработка выбора размера
bot.callbackQuery(/^size:(.+)$/, async ctx => {
	await ctx.answerCallbackQuery('Размер. Ответ записывается...')
	const size = ctx.match[1]
	const userId = ctx.from.id
	userSelections[userId].size = size

	// Устанавливаем значение по умолчанию для quantity
	if (!userSelections[userId].quantity) {
		userSelections[userId].quantity = 1 // Установим 1, если еще не установлено
	}

	const keyboard = createQuantityKeyboard(userSelections[userId].quantity) // Передаем текущее количество
	await ctx.reply('Выберите количество товара:', { reply_markup: keyboard })
})

// Обработка динамического изменения количества товара (для кнопок "-" и "+")
bot.callbackQuery(/quantity:(minus|plus)/, async ctx => {
	const userId = ctx.from.id
	let { quantity, maxQuantity } = userSelections[userId]

	// Установим значение по умолчанию, если quantity или maxQuantity не определены
	quantity = quantity || 1 // Убедитесь, что quantity не undefined
	maxQuantity =
		maxQuantity ||
		DATARECORDS.Products[userSelections[userId].category].color[
			userSelections[userId].color
		].size[userSelections[userId].size]

	const action = ctx.match[1]
	let newQuantity = quantity

	// Изменение количества в зависимости от действия
	if (action === 'minus' && quantity > 1) {
		newQuantity--
	} else if (action === 'plus' && quantity < maxQuantity) {
		newQuantity++
	}

	// Проверяем, изменилось ли количество. Если да, то обновляем клавиатуру.
	if (newQuantity !== quantity) {
		userSelections[userId].quantity = newQuantity // Сохраняем новое значение quantity
		await ctx.answerCallbackQuery({
			text: `Вы выбрали количество: ${newQuantity}`,
		})
		await ctx.editMessageReplyMarkup({
			reply_markup: createQuantityKeyboard(newQuantity, maxQuantity),
		})
	} else {
		await ctx.answerCallbackQuery({
			text: 'Невозможно изменить количество.',
			show_alert: true,
		})
	}
})

// Обработка выбора количества товара (при нажатии на текущее количество)
bot.callbackQuery('quantity:current', async ctx => {
	const userId = ctx.from.id
	const { category, color, size, quantity } = userSelections[userId]

	if (quantity === undefined) {
		console.error(
			'Количество не установлено для добавления товара в корзину:',
			{ userId }
		)
		await ctx.answerCallbackQuery({
			text: 'Ошибка при добавлении товара в корзину. Попробуйте еще раз.',
			show_alert: true,
		})
		return // Выходим, если данные некорректны
	}

	const product = DATARECORDS.Products[category] // Проверка на наличие товара и цены

	if (!product || !product.price) {
		console.error('Товар не найден или цена отсутствует:', { category })
		await ctx.answerCallbackQuery({
			text: 'Ошибка при добавлении товара в корзину. Попробуйте еще раз.',
			show_alert: true,
		})
		return // Выходим, если данные некорректны
	} // Проверка доступного количества товара

	const maxQuantity = DATARECORDS.Products[category].color[color].size[size]

	if (quantity > maxQuantity || maxQuantity <= 0) {
		await ctx.answerCallbackQuery({
			text: 'Данного товара нет в наличии. Можете поискать что-то другое.',
			show_alert: true,
		})
		return // Не добавляем товар в корзину
	} // Сохранение товара в объекте PERSONDATA

	if (!PERSONDATA.order) PERSONDATA.order = [] // Проверка, существует ли order

	PERSONDATA.order.push({
		title: product.title,
		color,
		size,
		quantity,
		price: product.price, // Убедитесь, что цена товара корректна
		total: product.price * quantity, // Вычисляем общую стоимость
	})

	PERSONDATA.paymentOrder.push({
		label: `${product.title} ${size} ${color}: ${quantity}шт.`,
		amount: 100 * product.price * quantity, // Вычисляем общую стоимость
	}) // Всплывающее сообщение о добавлении товара в корзину

	await ctx.answerCallbackQuery({
		text: `Товар добавлен в корзину: ${quantity} шт. ${product.title} (${color}, размер: ${size})`,
		show_alert: true,
	}) // Подытоживание заказа и предложение перейти к оплате или добавить еще товары

	await ctx.reply(`Заказ добавлен в корзину`, {
		reply_markup: new InlineKeyboard()
			.text('Очистить корзину', 'action:clear')
			.text('Добавить еще товар', 'action:add')
			.text('Перейти к оплате', 'action:checkout'),
	})
})

// Обработка очистки корзины
bot.callbackQuery('action:clear', async ctx => {
	await ctx.answerCallbackQuery('Очищение корзины...')
	const userId = ctx.from.id

	// Очистка корзины
	if (cart[userId]) {
		cart[userId] = [] // Очистка массива cart
	}

	if (PERSONDATA.order) {
		PERSONDATA.order = [] // Очистка массива заказов
	}

	if (PERSONDATA.order) {
		PERSONDATA.paymentOrder = [] // Очистка массива заказов
	}

	if (PERSONDATA.order) {
		PERSONDATA.dataOrder = null
	}

	const keyboard = createCategoryKeyboard() // Создаем клавиатуру для выбора категории
	if (DATARECORDS.GeneralMedia.general.length) {
		await ctx.replyWithMediaGroup(DATARECORDS.GeneralMedia.general) // Отправка медиа, если есть
	}

	await ctx.reply('Корзина очищена. Выберите категорию товара:', {
		reply_markup: keyboard, // Отправка клавиатуры для выбора категории
	})
})

// Обработка добавления нового товара
bot.callbackQuery('action:add', async ctx => {
	await ctx.answerCallbackQuery('Создается новый заказ...')
	const keyboard = createCategoryKeyboard()
	if (DATARECORDS.GeneralMedia.general.length) {
		await ctx.replyWithMediaGroup(DATARECORDS.GeneralMedia.general)
	}
	await ctx.reply('Выберите категорию товара:', { reply_markup: keyboard })
})

// Обработка перехода к оплате
bot.callbackQuery('action:checkout', async ctx => {
	await ctx.answerCallbackQuery('Подытоживаем...')
	const userId = ctx.from.id
	const toPayKeyboard = new InlineKeyboard().text('Оплатить', 'to-pay')

	// Проверка на наличие товаров в заказе
	if (!PERSONDATA.order || PERSONDATA.order.length === 0) {
		const keyboard = new InlineKeyboard().text(
			'Совершить новый заказ',
			'action:add'
		)
		await ctx.reply('Ваша корзина пуста.', { reply_markup: keyboard })
	} else {
		let message = 'Ваш заказ:\n'
		let total = 0
		PERSONDATA.order.forEach((item, index) => {
			const itemTotal = item.price * item.quantity // Вычисление стоимости каждого товара
			total += itemTotal
			message += `${index + 1}. ${item.title}, Цвет: ${item.color}, Размер: ${
				item.size
			}, Количество: ${item.quantity}, Цена: ${
				item.price
			}, Всего: ${itemTotal}\n`
		})
		message += `\nОбщая стоимость: ${total}₽` // Общая стоимость всех товаров
		PERSONDATA.dataOrder = message
		await ctx.reply(message, {
			reply_markup: toPayKeyboard,
		})
	}
})

// Обработка нажатия на кнопку "Назад" для возврата к выбору категории
bot.callbackQuery('back:category', async ctx => {
	await ctx.answerCallbackQuery('Назад к категориям...')
	const keyboard = createCategoryKeyboard()
	if (DATARECORDS.GeneralMedia.general.length) {
		await ctx.replyWithMediaGroup(DATARECORDS.GeneralMedia.general)
	}
	await ctx.reply('Выберите категорию товара:', { reply_markup: keyboard })
})

// Обработка нажатия на кнопку "Назад" для возврата к выбору цвета
bot.callbackQuery('back:color', async ctx => {
	await ctx.answerCallbackQuery('Назад к цветам...')
	const userId = ctx.from.id
	const category = userSelections[userId].category
	const keyboard = createColorKeyboard(category)
	if (DATARECORDS.GeneralMedia.categories[category]?.length) {
		await ctx.replyWithMediaGroup(DATARECORDS.GeneralMedia.categories[category])
	}
	await ctx.reply('Выберите цвет товара:', { reply_markup: keyboard })
})

// Обработка нажатия на кнопку "Назад" для возврата к выбору размера
bot.callbackQuery('back:size', async ctx => {
	await ctx.answerCallbackQuery('Назад к выбору размера...')
	const userId = ctx.from.id
	const category = userSelections[userId].category
	const color = userSelections[userId].color
	const keyboard = createSizeKeyboard(category, color)
	await ctx.replyWithMediaGroup(
		DATARECORDS.Products[category].color[color].media
	)
	await ctx.reply('Выберите размер товара:', { reply_markup: keyboard })
})

// ------------------------------------------------------------------
// -----------------------------------------------------------------
// ОПЛАТА

bot.callbackQuery('to-pay', async ctx => {
	await ctx.answerCallbackQuery('Отправка счета...')
	getUserData(ctx)
	await PAYCommand(ctx)
})

function generatePayTypes(type) {
	// Генерация случайного 4-значного числа
	const randomFourDigitNumber = Math.floor(1000 + Math.random() * 9000)

	// Создание строкового представления payload
	const payloadType = `${type}_${PERSONDATA.id}-${randomFourDigitNumber}`

	return payloadType
}

async function PAYCommand(ctx) {
	try {
		let UniquePayload = generatePayTypes('UNIQUE-PAYLOAD')
		await ctx.replyWithInvoice(
			`Заказ для ${PERSONDATA.fullName}`,
			`Христианская одежда Альфа&Омега`,
			UniquePayload,
			'RUB',
			PERSONDATA.paymentOrder,
			{
				provider_token: process.env.PROVIDER_TOKEN,
				start_parameter: generatePayTypes('START-PARAMETER'),
				need_name: true,
				need_phone_number: true,
				need_email: true,
				is_flexible: true,
				photo_url:
					'https://img1.akspic.ru/previews/4/2/8/8/7/178824/178824-chest-xiaomi-soobshhestvo_syaomi-smartfon-chest_80_za-x750.jpg',
				shipping_options: [
					{
						id: 'shipping_1',
						title: 'Бонус',
						prices: [{ label: 'Спасибо за сервис', amount: 1 * 50 }],
					},
					{
						id: 'shipping_2',
						title: 'Чаевые',
						prices: [{ label: 'Спасибо за то, что вы есть', amount: 1 * 250 }],
					},
					{
						id: 'shipping_3',
						title: 'На развитие',
						prices: [{ label: 'Хочу, чтоб бренд процветал', amount: 1 * 1000 }],
					},
					{
						id: 'shipping_4',
						title: 'На ускорение',
						prices: [{ label: 'За все слава Богу', amount: 1 * 5000 }],
					},
					{
						id: 'shipping_5',
						title: 'Без чаевых',
						prices: [{ label: 'Нет', amount: 0 }],
					},
				],
			}
		)
		console.log('Счет успешно выставлен.')
	} catch (error) {
		console.error('Ошибка при выставлении счета:', error)
		await ctx.reply(
			'Ошибка при выставлении счета, пожалуйста, обратитесь в поддержку...'
		)
	}
}

async function cleanData() {
	PERSONDATA = {
		payName: null,
		phone: null,
		location: null,
		mail: null,
		order: [],
		paymentOrder: [],
		dataOrder: null,
	}
	cart = {}
	userSelections = {}
	console.log('Данные очищены.')
}

// Обработка запросов на доставку
bot.on('shipping_query', async ctx => {
	console.log('Получен запрос на доставку:', ctx.shippingQuery)

	const shippingOptions = [
		{
			id: 'shipping_1',
			title: 'Бонус',
			prices: [{ label: 'Спасибо за сервис', amount: 1 * 50 }],
		},
		{
			id: 'shipping_2',
			title: 'Чаевые',
			prices: [{ label: 'Спасибо за то, что вы есть', amount: 1 * 250 }],
		},
		{
			id: 'shipping_3',
			title: 'На развитие',
			prices: [{ label: 'Хочу, чтоб бренд процветал', amount: 1 * 1000 }],
		},
		{
			id: 'shipping_4',
			title: 'На ускорение',
			prices: [{ label: 'За все слава Богу', amount: 1 * 5000 }],
		},
		{
			id: 'shipping_5',
			title: 'Без чаевых',
			prices: [{ label: 'Нет', amount: 0 }],
		},
	]

	// Отправляем ответ на запрос доставки
	try {
		await ctx.answerShippingQuery(true, {
			shipping_options: shippingOptions,
		})
		console.log('Отправлен ответ на запрос доставки.')
	} catch (error) {
		console.error('Ошибка при ответе на запрос доставки:', error)
	}
})

bot.on('pre_checkout_query', async ctx => {
	console.log('Получен предварительный запрос на оплату:', ctx.preCheckoutQuery)

	const isPaymentValid = true // Логика проверки платежа (например, проверка наличия средств)
	const { shipping_option_id } = ctx.preCheckoutQuery

	// Проверим, что выбранный вариант доставки валиден
	if (shipping_option_id) {
		if (isPaymentValid) {
			await ctx.answerPreCheckoutQuery(true)
		} else {
			await ctx.answerPreCheckoutQuery(
				false,
				'Ошибка при оплате (недостаточно средств).'
			)
		}
	} else {
		await ctx.answerPreCheckoutQuery(
			false,
			'Пожалуйста, выберите вариант доставки.'
		)
	}
	console.log('Предварительный запрос на оплату обработан.')
})

bot.callbackQuery('newBuyAfter', async ctx => {
	await ctx.answerCallbackQuery('Подготавливаем сервис...')
	NEWBUYCommand(ctx)
})

bot.on('message', async ctx => {
	if (ctx.message && ctx.message.successful_payment) {
		const successfulPayment = ctx.message.successful_payment
		const newBuyKeyboard = new InlineKeyboard().text(
			'Новая покупка',
			'newBuyAfter'
		)
		try {
			const amount = successfulPayment.total_amount
			const currency = successfulPayment.currency
			const telegramPaymentChargeId =
				successfulPayment.telegram_payment_charge_id
			const providerPaymentChargeId =
				successfulPayment.provider_payment_charge_id

			console.log(
				`Платеж успешен: ${
					amount / 100
				} ${currency}, ID Telegram: ${telegramPaymentChargeId}, ID провайдера: ${providerPaymentChargeId}`
			)
			// Сохраняем данные, введенные пользователем при оплате
			PERSONDATA.phone = successfulPayment.order_info.phone_number
			PERSONDATA.location = `${successfulPayment.order_info.shipping_address.country_code} ${successfulPayment.order_info.shipping_address.state} ${successfulPayment.order_info.shipping_address.city} ${successfulPayment.order_info.shipping_address.street_line1} ${successfulPayment.order_info.shipping_address.street_line2} ${successfulPayment.order_info.shipping_address.post_code}`
			successfulPayment.order_info.shipping_address
			PERSONDATA.mail = successfulPayment.order_info.email
			PERSONDATA.payName = successfulPayment.order_info.name
			await sendFinalDataToBase(ctx)
			await ctx.reply(
				`Спасибо за ваш платеж! Сумма: ${amount / 100} ${currency}.`,
				{
					reply_markup: newBuyKeyboard,
				}
			)
		} catch (error) {
			console.error('Ошибка при обработке успешного платежа:', error)
			await ctx.reply(
				'Произошла ошибка при обработке вашего платежа. Пожалуйста, свяжитесь с поддержкой.'
			)
		} finally {
			await cleanData()
		}
	} else {
		console.log('Сообщение не содержит успешного платежа.')
	}
})

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Обработчик ошибок
bot.catch(err => {
	const ctx = err.ctx
	console.error(`Error while handling update ${ctx.update.update_id}:`)
	const e = err.error
	if (e instanceof GrammyError) {
		console.error('Error in request:', e.description)
	} else if (e instanceof HttpError) {
		console.error('Could not contact Telegram:', e)
	} else {
		console.error('Unknown error:', e)
	}
})

// Запуск сервера на порту 443
httpsServer.listen(process.env.PORT, () => {
	console.log('HTTPS Server running...')
})

// Запуск бота
bot.start()
