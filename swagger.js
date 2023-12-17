const swaggerAutogen = require('swagger-autogen')({language: 'ru-RU', openapi: '3.0.0'})

const outputFile = './dist/swagger_output.json'
const endpointsFiles = ['./initExpress.ts']

swaggerAutogen(outputFile, endpointsFiles, {
	info:{
		title: "RAFT API"
	},
	host: process.env.SWAGGER_HOST,
	openapi: '3.0.0',
})
