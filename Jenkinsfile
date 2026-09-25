pipeline {
    agent any

    triggers {
        githubPush()
    }


    environment {
        IMAGE_NAME = 'ghcr.io/agungadisaputra04/linkpendek-devops'
        IMAGE_TAG  = "${BUILD_NUMBER}"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('QA / Quality Gate') {
            steps {
                sh 'npm audit --omit=dev --audit-level=high'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    docker pull node:20-bookworm-slim
                    docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
                '''
            }
        }

        stage('Container Security Scan') {
            steps {
                sh '''
                    trivy --config /dev/null image \
                        --severity CRITICAL \
                        --ignore-unfixed \
                        --timeout 20m \
                        --exit-code 1 \
                        ${IMAGE_NAME}:${IMAGE_TAG}

                    trivy --config /dev/null image \
                        --severity HIGH,CRITICAL \
                        --timeout 20m \
                        --exit-code 0 \
                        --format table \
                        ${IMAGE_NAME}:${IMAGE_TAG} > trivy-full-report.txt || true
                '''
                archiveArtifacts artifacts: 'trivy-full-report.txt', allowEmptyArchive: true
            }
        }

        stage('Push GHCR') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'ghcr-credentials',
                        usernameVariable: 'GHCR_USER',
                        passwordVariable: 'GHCR_TOKEN'
                    )
                ]) {
                    sh '''
                        echo "$GHCR_TOKEN" | docker login ghcr.io \
                            -u "$GHCR_USER" \
                            --password-stdin

                        docker push ${IMAGE_NAME}:${IMAGE_TAG}

                        docker logout ghcr.io
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "CI pipeline SUCCESS: ${IMAGE_NAME}:${IMAGE_TAG}"
        }

        failure {
            echo "CI pipeline FAILED"
        }

        always {
            sh 'docker image rm ${IMAGE_NAME}:${IMAGE_TAG} || true'
        }
    }
}